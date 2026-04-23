'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Postiz Devvit app slug published on Reddit's developer portal. Surfaced via env so we can
// switch between dev/prod apps without a code change.
const DEVVIT_APP_SLUG =
  process.env.NEXT_PUBLIC_POSTIZ_REDDIT_DEVVIT_APP_SLUG || 'postiz-scheduler';

type PairStatus =
  | { status: 'pending' }
  | { status: 'bound'; subreddit: string; redditUsername: string; integrationId: string }
  | { status: 'expired' };

export const RedditDevvitConnect: FC<{ state: string }> = ({ state }) => {
  const t = useT();
  const fetch = useFetch();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<PairStatus>({ status: 'pending' });
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const init = useCallback(async () => {
    if (!state) {
      setError('Missing state. Please restart the connect flow.');
      return;
    }
    try {
      const res = await fetch('/public/reddit-devvit/pair/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { code: string };
      setCode(data.code);
    } catch (e: any) {
      setError(e?.message || 'Failed to obtain pair code');
    }
  }, [fetch, state]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!code) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/public/reddit-devvit/pair/status?code=${encodeURIComponent(code)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as PairStatus;
        setStatus(data);
        if (data.status === 'bound') {
          if (pollRef.current) clearInterval(pollRef.current);
          setTimeout(() => router.push('/launches'), 1500);
        }
        if (data.status === 'expired') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // transient; keep polling
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [code, fetch, router]);

  const installUrl = `https://developers.reddit.com/apps/${DEVVIT_APP_SLUG}`;

  return (
    <div className="mx-auto max-w-[640px] p-[24px] flex flex-col gap-[20px]">
      <h1 className="text-[24px] font-[700]">
        {t('connect_reddit_devvit', 'Connect Reddit (Devvit)')}
      </h1>

      <div className="text-[13px] opacity-80 leading-[20px]">
        {t(
          'reddit_devvit_intro',
          'Reddit has deprecated self-serve API access. This integration uses a Postiz Devvit app that is installed in the subreddit you want to post to. Posts will be submitted by the Postiz app account (not your personal Reddit account) until Reddit grants runAs USER approval.'
        )}
      </div>

      {error && (
        <div className="p-[12px] bg-red-900/30 border border-red-500 text-red-200 text-[13px]">
          {error}
        </div>
      )}

      <ol className="list-decimal pl-[20px] flex flex-col gap-[16px] text-[14px]">
        <li>
          {t('open_devvit_install', 'Open the Postiz Devvit app and install it on the subreddit you moderate:')}
          <div className="mt-[6px]">
            <a
              className="text-blue-400 underline break-all"
              href={installUrl}
              target="_blank"
              rel="noreferrer"
            >
              {installUrl}
            </a>
          </div>
        </li>
        <li>
          {t(
            'click_menu_action',
            'In that subreddit, open the three-dot menu and click "Link this subreddit to Postiz".'
          )}
        </li>
        <li>
          {t('enter_this_pair_code', 'Enter this pair code when prompted:')}
          <div className="mt-[8px] text-[32px] font-mono tracking-[6px] bg-customColor37 px-[16px] py-[12px] text-center border border-tableBorder">
            {code || '......'}
          </div>
        </li>
      </ol>

      {status.status === 'pending' && code && (
        <div className="text-[12px] opacity-60">
          {t('waiting_for_devvit', 'Waiting for the Devvit app to call back... (this page will redirect automatically)')}
        </div>
      )}
      {status.status === 'bound' && (
        <div className="text-[14px] text-green-400">
          {t('paired_success', 'Paired to r/{{subreddit}} as u/{{user}}. Redirecting...', {
            subreddit: status.subreddit,
            user: status.redditUsername,
          })}
        </div>
      )}
      {status.status === 'expired' && (
        <div className="flex flex-col gap-[8px]">
          <div className="text-[14px] text-red-400">
            {t('pair_expired', 'Pair code expired.')}
          </div>
          <Button onClick={init}>{t('request_new_code', 'Request a new code')}</Button>
        </div>
      )}
    </div>
  );
};
