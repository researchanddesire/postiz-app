# Postiz Reddit Devvit app

A Devvit Web app that runs inside Reddit and drains scheduled posts from Postiz's API, submitting them to the subreddit where it's installed.

This is the companion to the `reddit-devvit` provider in `libraries/nestjs-libraries/src/integrations/social/reddit-devvit.provider.ts`. It exists because Reddit has deprecated self-serve `/prefs/apps` OAuth access for new users and is redirecting everyone to Devvit instead.

## Architecture

```
Postiz UI   →  pair code page
Postiz API  ←  POST /public/reddit-devvit/pair      ← Devvit menu action
Postiz API  ←  GET  /public/reddit-devvit/pending   ← Devvit scheduler cron (every 60s)
Postiz API  ←  POST /public/reddit-devvit/result    ← after reddit.submitPost
```

Each Devvit install = one Postiz `Integration` row pinned to one subreddit. Posts are submitted as the **app account** (`runAs: 'APP'`) in v1 — posts will not be attributed to the connecting user's Reddit account. See the [User Actions docs](https://developers.reddit.com/docs/capabilities/server/userActions) for the path to `runAs: 'USER'` attribution (requires Reddit admin approval and forces every post to be an experience/custom post).

## Prerequisites

1. Reddit developer account.
2. **Domain allow-list:** Postiz's API domain (`postiz.researchanddesire.com` in prod) must be on Reddit's allow-list for this app. Request it via the r/devvit modmail or the approval form linked from the [HTTP Fetch docs](https://developers.reddit.com/docs/capabilities/server/http-fetch). This is a per-app approval, not a global one.
3. Install Node 22+ and run `npx devvit login`.

## First-time setup

```bash
cd apps/reddit-devvit
pnpm install
npx devvit login                                  # one-time
npx devvit settings set postizBaseUrl https://postiz.researchanddesire.com
npx devvit upload                                 # pushes a new version to Reddit, private by default
npx devvit publish                                # submits for Reddit review so it can be installed publicly
```

Dev loop:

```bash
npx devvit playtest r/<your-test-sub>
```

## Install in a subreddit

```bash
npx devvit install r/<subreddit> postiz-scheduler@latest
```

Then moderators of that subreddit:
1. Open Postiz → Channels → Reddit (Devvit) → Connect. A 6-character pair code appears.
2. In the subreddit, open the three-dot menu → **Link this subreddit to Postiz** → paste the pair code.
3. Postiz's Channels list shows `r/<subreddit>` bound to the user's Reddit handle.

## Runtime behaviour

- **Cron:** `scheduler.drain-postiz` runs every minute, calls `GET /pending`, processes up to 10 jobs per tick (inside the Devvit 30s execution limit).
- **Storage:** the integration token returned by Postiz is stored in per-install Redis under `postiz:integrationToken`.
- **Unlink:** the "Unlink from Postiz" menu action deletes the Redis keys; the Postiz Integration row is left in place (mark it disconnected from the Postiz UI instead).

## Known limitations (v1)

- Text and link posts only. No images, no video, no flair, no comment threads.
- Posts are attributed to the Postiz app account, not the user. Title prefix is recommended if attribution is important.
- One subreddit per install; to post to N subreddits the user installs the app in N subreddits and pairs each.
- No retry loop if Postiz is down; the Postiz-side queue simply grows until Postiz recovers.
