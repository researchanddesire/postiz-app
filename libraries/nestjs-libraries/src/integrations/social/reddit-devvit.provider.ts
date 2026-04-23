import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { RedditDevvitSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/reddit-devvit.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// Connect flow:
//   1. User clicks Connect in Postiz UI -> generateAuthUrl() returns the internal /integrations/reddit-devvit/connect page.
//   2. Connect page shows a 6-char pair code; poll /public/reddit-devvit/pair/status until bound.
//   3. User installs the Postiz Devvit app in their subreddit and runs the "Link to Postiz" menu action,
//      which calls POST /public/reddit-devvit/pair with { code, subredditName, redditUsername }.
//   4. Postiz creates an Integration row and returns integrationToken to the Devvit app.
//
// Post flow:
//   1. Postiz dispatches post(id, accessToken, postDetails): we push a job blob into a Redis list
//      keyed by integrationId. Return a placeholder postId; /result will update the Post with the real URL.
//   2. Devvit app cron polls GET /public/reddit-devvit/pending (bearer = integrationToken),
//      submits via reddit.submitPost({ runAs: 'APP' }), and calls POST /public/reddit-devvit/result.

const REDDIT_DEVVIT_PAIR_KEY_PREFIX = 'reddit-devvit:pair:';
const REDDIT_DEVVIT_QUEUE_KEY_PREFIX = 'reddit-devvit:queue:';
const REDDIT_DEVVIT_JOB_KEY_PREFIX = 'reddit-devvit:job:';
export const REDDIT_DEVVIT_PAIR_TTL_SECONDS = 15 * 60;
export const REDDIT_DEVVIT_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

export const redditDevvitRedisKeys = {
  pair: (code: string) => `${REDDIT_DEVVIT_PAIR_KEY_PREFIX}${code}`,
  queue: (integrationId: string) =>
    `${REDDIT_DEVVIT_QUEUE_KEY_PREFIX}${integrationId}`,
  job: (jobId: string) => `${REDDIT_DEVVIT_JOB_KEY_PREFIX}${jobId}`,
};

export interface RedditDevvitQueueJob {
  jobId: string;
  postId: string;
  integrationId: string;
  subreddit: string;
  title: string;
  type: 'self' | 'link';
  text?: string;
  url?: string;
  createdAt: number;
}

export class RedditDevvitProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'reddit-devvit';
  name = 'Reddit (Devvit)';
  isBetweenSteps = false;
  scopes: string[] = [];
  editor = 'normal' as const;
  dto = RedditDevvitSettingsDto;
  toolTip =
    'Beta. Posts are submitted by the Postiz Devvit app account, not your Reddit account. You must install the Postiz app in each target subreddit.';

  maxLength() {
    return 10000;
  }

  // No OAuth: return a URL pointing at the Postiz connect page that shows a pair code.
  // The caller (integrations.controller) already stores `organization:${state}` in Redis,
  // so we just need to forward the state so the connect page can call /pair/new.
  async generateAuthUrl() {
    const state = makeId(6);
    const codeVerifier = makeId(30);
    const url = `${process.env.FRONTEND_URL}/integrations/reddit-devvit?state=${state}`;
    return { url, codeVerifier, state };
  }

  // Authenticate is invoked by the /public/reddit-devvit/pair endpoint.
  // The controller resolves the pair code, then builds the AuthTokenDetails before writing the Integration.
  // This method is required by the interface but won't be called via the normal OAuth callback flow.
  async authenticate(): Promise<AuthTokenDetails | string> {
    return 'Reddit (Devvit) pairing is completed by the Postiz Devvit app, not by OAuth redirect.';
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    throw new Error(
      'Reddit (Devvit) does not use OAuth tokens; integrationToken is long-lived.'
    );
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<RedditDevvitSettingsDto>[]
  ): Promise<PostResponse[]> {
    const [post] = postDetails;
    if (!post?.settings?.subreddit?.length) {
      return [];
    }

    const responses: PostResponse[] = [];
    for (const entry of post.settings.subreddit) {
      const value = entry.value;
      const job: RedditDevvitQueueJob = {
        jobId: makeId(20),
        postId: post.id,
        integrationId: id,
        subreddit: value.subreddit.replace(/^\/?r\//i, ''),
        title: value.title,
        type: value.type,
        text: value.type === 'self' ? post.message : undefined,
        url: value.type === 'link' ? value.url : undefined,
        createdAt: Date.now(),
      };

      await ioRedis.rpush(
        redditDevvitRedisKeys.queue(id),
        JSON.stringify(job)
      );
      await ioRedis.set(
        redditDevvitRedisKeys.job(job.jobId),
        JSON.stringify({ ...job, status: 'pending' }),
        'EX',
        REDDIT_DEVVIT_JOB_TTL_SECONDS
      );

      responses.push({
        id: post.id,
        postId: `pending:${job.jobId}`,
        releaseURL: '',
        status: 'published',
      });
    }

    return responses;
  }
}
