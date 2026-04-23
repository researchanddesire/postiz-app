import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  redditDevvitRedisKeys,
  REDDIT_DEVVIT_PAIR_TTL_SECONDS,
  RedditDevvitQueueJob,
} from '@gitroom/nestjs-libraries/integrations/social/reddit-devvit.provider';

const REDDIT_DEVVIT_TOKEN_KEY_PREFIX = 'reddit-devvit:token:';
const tokenKey = (token: string) => `${REDDIT_DEVVIT_TOKEN_KEY_PREFIX}${token}`;

// Devvit-facing endpoints (no Postiz user auth; bearer token is the Integration's access token).
// The Postiz frontend also hits /pair/new and /pair/status.

const PAIR_CODE_LENGTH = 6;
const INTEGRATION_TOKEN_LENGTH = 40;
const MAX_JOBS_PER_POLL = 10;

interface PairRecord {
  orgId: string;
  timezone: number;
  status: 'pending' | 'bound';
  integrationId?: string;
  subreddit?: string;
  redditUsername?: string;
  createdAt: number;
}

@ApiTags('Reddit Devvit')
@Controller('/public/reddit-devvit')
export class RedditDevvitController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService
  ) {}

  // Called by the Postiz frontend after the user clicks "Connect" on the reddit-devvit channel.
  // The frontend passes the org id + timezone via a short-lived signed state (Postiz already stores
  // login/organization in Redis keyed by state from the normal connect flow). Here we accept either
  // an explicit org id (internal use) or an existing Postiz state cookie. For simplicity v1 takes
  // { state } matching the existing connect state the frontend just generated.
  @Post('/pair/new')
  async newPair(@Body() body: { state: string; timezone?: number }) {
    if (!body?.state) {
      throw new BadRequestException('state required');
    }
    const orgId = await ioRedis.get(`organization:${body.state}`);
    if (!orgId) {
      throw new BadRequestException('invalid state');
    }
    const code = makeId(PAIR_CODE_LENGTH).toUpperCase();
    const record: PairRecord = {
      orgId,
      timezone: Number(body.timezone ?? 0),
      status: 'pending',
      createdAt: Date.now(),
    };
    await ioRedis.set(
      redditDevvitRedisKeys.pair(code),
      JSON.stringify(record),
      'EX',
      REDDIT_DEVVIT_PAIR_TTL_SECONDS
    );
    return { code, expiresIn: REDDIT_DEVVIT_PAIR_TTL_SECONDS };
  }

  // Polled by the Postiz frontend until the Devvit app has completed pairing.
  @Get('/pair/status')
  async pairStatus(@Query('code') code: string) {
    if (!code) {
      throw new BadRequestException('code required');
    }
    const raw = await ioRedis.get(redditDevvitRedisKeys.pair(code));
    if (!raw) {
      return { status: 'expired' };
    }
    const record = JSON.parse(raw) as PairRecord;
    return {
      status: record.status,
      subreddit: record.subreddit,
      redditUsername: record.redditUsername,
      integrationId: record.integrationId,
    };
  }

  // Called by the Devvit app's "Link to Postiz" menu/form handler.
  @Post('/pair')
  async completePair(
    @Body()
    body: {
      code: string;
      subredditName: string;
      redditUsername: string;
    }
  ) {
    const { code, subredditName, redditUsername } = body ?? ({} as any);
    if (!code || !subredditName || !redditUsername) {
      throw new BadRequestException('code, subredditName, redditUsername required');
    }

    const upperCode = String(code).toUpperCase();
    const raw = await ioRedis.get(redditDevvitRedisKeys.pair(upperCode));
    if (!raw) {
      throw new BadRequestException('invalid or expired pair code');
    }
    const record = JSON.parse(raw) as PairRecord;
    if (record.status !== 'pending') {
      throw new BadRequestException('pair code already used');
    }

    const cleanSub = String(subredditName).replace(/^\/?r\//i, '');
    const internalId = `reddit-devvit:${cleanSub}:${redditUsername}`;
    const integrationToken = makeId(INTEGRATION_TOKEN_LENGTH);

    const integration = await this._integrationService.createOrUpdateIntegration(
      undefined,
      false,
      record.orgId,
      `r/${cleanSub}`,
      '',
      'social',
      internalId,
      'reddit-devvit',
      integrationToken,
      undefined,
      undefined,
      redditUsername,
      false
    );

    // Bearer-token lookup: Integration.accessToken is stored encrypted in the DB,
    // so we keep a Redis plaintext mapping of token -> {integrationId, orgId}.
    await ioRedis.set(
      tokenKey(integrationToken),
      JSON.stringify({ integrationId: integration.id, orgId: record.orgId })
    );

    record.status = 'bound';
    record.integrationId = integration.id;
    record.subreddit = cleanSub;
    record.redditUsername = redditUsername;
    await ioRedis.set(
      redditDevvitRedisKeys.pair(upperCode),
      JSON.stringify(record),
      'EX',
      REDDIT_DEVVIT_PAIR_TTL_SECONDS
    );

    // integrationToken is the bearer the Devvit app will present on every subsequent call.
    return {
      integrationToken,
      integrationId: integration.id,
      subreddit: cleanSub,
    };
  }

  // Called by the Devvit app scheduler cron every minute.
  // Pops up to MAX_JOBS_PER_POLL jobs from the integration's queue and returns them.
  @Get('/pending')
  async pending(@Headers('authorization') authHeader: string | undefined) {
    const integration = await this.resolveIntegration(authHeader);
    const jobs: RedditDevvitQueueJob[] = [];
    for (let i = 0; i < MAX_JOBS_PER_POLL; i++) {
      const raw = await ioRedis.lpop(
        redditDevvitRedisKeys.queue(integration.id)
      );
      if (!raw) break;
      try {
        jobs.push(JSON.parse(raw) as RedditDevvitQueueJob);
      } catch {
        // skip malformed job
      }
    }
    return { jobs };
  }

  // Called by the Devvit app after it submits each job to Reddit.
  @Post('/result')
  async result(
    @Headers('authorization') authHeader: string | undefined,
    @Body()
    body: {
      jobId: string;
      redditPostId?: string;
      permalink?: string;
      error?: string;
    }
  ) {
    const integration = await this.resolveIntegration(authHeader);
    const { jobId, redditPostId, permalink, error } = body ?? ({} as any);
    if (!jobId) {
      throw new BadRequestException('jobId required');
    }

    const raw = await ioRedis.get(redditDevvitRedisKeys.job(jobId));
    if (!raw) {
      return { ok: false, reason: 'job not found' };
    }
    const job = JSON.parse(raw) as RedditDevvitQueueJob & { status?: string };
    if (job.integrationId !== integration.id) {
      throw new ForbiddenException('integration mismatch');
    }

    const url = permalink ? `https://www.reddit.com${permalink}` : '';
    if (redditPostId) {
      await this._postsService.updatePost(job.postId, redditPostId, url);
    }

    job.status = error ? `failed: ${error}` : 'sent';
    await ioRedis.set(
      redditDevvitRedisKeys.job(jobId),
      JSON.stringify(job),
      'KEEPTTL'
    );

    return { ok: true };
  }

  private async resolveIntegration(authHeader: string | undefined) {
    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw new ForbiddenException('missing bearer token');
    }
    const rawMapping = await ioRedis.get(tokenKey(token));
    if (!rawMapping) {
      throw new ForbiddenException('invalid integration token');
    }
    const { integrationId, orgId } = JSON.parse(rawMapping) as {
      integrationId: string;
      orgId: string;
    };
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration || integration.providerIdentifier !== 'reddit-devvit') {
      throw new ForbiddenException('invalid integration token');
    }
    return integration;
  }
}
