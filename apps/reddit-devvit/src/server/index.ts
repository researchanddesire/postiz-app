import { Hono } from 'hono';
// Devvit-provided globals; package names follow the current Devvit Web docs.
// @ts-ignore - types shipped by @devvit/web at runtime
import { context, reddit, redis, settings } from '@devvit/web/server';

import { PostizClient, PostizJob } from './postiz';

const app = new Hono();

const REDIS_KEYS = {
  integrationToken: 'postiz:integrationToken',
  subredditName: 'postiz:subreddit',
  redditUsername: 'postiz:redditUsername',
};

async function getPostiz(): Promise<PostizClient | null> {
  // postizBaseUrl is set via `devvit settings set postizBaseUrl https://postiz.researchanddesire.com`
  const baseUrl = (await settings.get('postizBaseUrl')) as string | undefined;
  const token = await redis.get(REDIS_KEYS.integrationToken);
  if (!baseUrl || !token) return null;
  return new PostizClient(baseUrl, token);
}

// --- Menu: open a form asking for the pair code -----------------------------

app.post('/internal/menu/link-postiz', async (c) => {
  return c.json({
    showForm: {
      name: 'pair-code-form',
      form: {
        title: 'Link to Postiz',
        description:
          'Paste the pair code shown on your Postiz "Connect Reddit (Devvit)" page.',
        acceptLabel: 'Link',
        cancelLabel: 'Cancel',
        fields: [
          {
            name: 'code',
            label: 'Pair code',
            type: 'string',
            required: true,
          },
        ],
      },
    },
  });
});

// --- Form submit handler: completes the pairing ------------------------------

app.post('/internal/forms/link-postiz', async (c) => {
  const body = await c.req.json<{ values: { code: string } }>();
  const code = (body?.values?.code || '').trim();
  if (!code) {
    return c.json({ showToast: { text: 'Missing code', appearance: 'neutral' } });
  }

  const baseUrl = (await settings.get('postizBaseUrl')) as string | undefined;
  if (!baseUrl) {
    return c.json({
      showToast: {
        text: 'App not configured: postizBaseUrl missing',
        appearance: 'neutral',
      },
    });
  }

  const subredditName = context.subredditName;
  if (!subredditName) {
    return c.json({
      showToast: { text: 'Could not resolve subreddit', appearance: 'neutral' },
    });
  }

  let redditUsername = '';
  try {
    const user = await reddit.getCurrentUser();
    redditUsername = user?.username || '';
  } catch {
    return c.json({
      showToast: { text: 'Could not read current user', appearance: 'neutral' },
    });
  }

  try {
    const client = new PostizClient(baseUrl, '');
    const { integrationToken } = await client.pair({
      code,
      subredditName,
      redditUsername,
    });
    await redis.set(REDIS_KEYS.integrationToken, integrationToken);
    await redis.set(REDIS_KEYS.subredditName, subredditName);
    await redis.set(REDIS_KEYS.redditUsername, redditUsername);
    return c.json({
      showToast: {
        text: `Linked r/${subredditName} to Postiz`,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    return c.json({
      showToast: {
        text: `Pair failed: ${err?.message || 'unknown error'}`,
        appearance: 'neutral',
      },
    });
  }
});

// --- Menu: unlink ------------------------------------------------------------

app.post('/internal/menu/unlink-postiz', async (c) => {
  await redis.del(REDIS_KEYS.integrationToken);
  await redis.del(REDIS_KEYS.subredditName);
  await redis.del(REDIS_KEYS.redditUsername);
  return c.json({
    showToast: { text: 'Unlinked from Postiz', appearance: 'success' },
  });
});

// --- Scheduler: pull pending jobs and submit them ---------------------------

app.post('/internal/scheduler/drain-postiz', async (c) => {
  const postiz = await getPostiz();
  if (!postiz) {
    return c.json({ status: 'not-linked' });
  }

  let jobs: PostizJob[] = [];
  try {
    jobs = await postiz.pending();
  } catch (err) {
    console.error('pending fetch failed', err);
    return c.json({ status: 'pending-failed' });
  }

  for (const job of jobs) {
    try {
      const submission: Record<string, unknown> = {
        subredditName: job.subreddit,
        title: job.title,
        runAs: 'APP',
      };
      if (job.type === 'link' && job.url) {
        submission['url'] = job.url;
      } else {
        submission['text'] = job.text ?? '';
      }

      // @ts-ignore - submitPost signature is the RedditAPIClient SubmitPostOptions union
      const post = await reddit.submitPost(submission);
      await postiz.reportResult({
        jobId: job.jobId,
        redditPostId: post?.id || '',
        permalink: post?.permalink || '',
      });
    } catch (err: any) {
      await postiz.reportResult({
        jobId: job.jobId,
        error: err?.message || 'submit failed',
      });
    }
  }

  return c.json({ status: 'ok', processed: jobs.length });
});

export default app;
