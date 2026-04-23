'use client';

import { FC, useEffect } from 'react';
import { useFieldArray, useWatch } from 'react-hook-form';
import clsx from 'clsx';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import {
  RedditDevvitSettingsDto,
  RedditDevvitSettingsValueDto,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/reddit-devvit.dto';
import { Input } from '@gitroom/react/form/input';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Reddit (Devvit) — one integration == one paired subreddit. The subreddit name
// is derived from the integration's display name (e.g. "r/mysub"), not user-picked.

const deriveSubreddit = (integrationName?: string | null) =>
  (integrationName || '').replace(/^\/?r\//i, '').trim();

const RedditDevvitPreview: FC = () => {
  const { integration, value: topValue } = useIntegration();
  const settings = useWatch({ name: 'subreddit' }) as
    | Array<RedditDevvitSettingsValueDto>
    | undefined;
  const [firstPost] = topValue;
  const subreddit = deriveSubreddit(integration?.name);
  const entry = settings?.[0]?.value;

  return (
    <div className="flex flex-col gap-[20px] w-full">
      <div
        className={clsx(
          'bg-customColor37 w-full p-[10px] flex flex-col border-tableBorder border'
        )}
      >
        <div className="flex flex-row gap-[8px] items-center mb-[8px]">
          <SafeImage
            width={40}
            height={40}
            src={`/icons/platforms/reddit-devvit.png`}
            alt="reddit"
            className="rounded-full"
          />
          <div className="flex flex-col">
            <div className="text-[12px] font-[700]">r/{subreddit}</div>
            <div className="text-[11px] opacity-70">
              Posted by the Postiz app on behalf of u/{integration?.profile}
            </div>
          </div>
        </div>
        <div className="font-[600] text-[20px] mb-[10px]">
          {entry?.title || 'Untitled'}
        </div>
        {entry?.type === 'link' ? (
          <div className="text-[13px] opacity-80 break-all">{entry?.url}</div>
        ) : (
          <div
            style={{ whiteSpace: 'pre-wrap', fontSize: '13px' }}
            dangerouslySetInnerHTML={{ __html: firstPost?.content || '' }}
          />
        )}
      </div>
    </div>
  );
};

const RedditDevvitSettings: FC = () => {
  const t = useT();
  const { register, control } = useSettings();
  const { integration } = useIntegration();
  const subreddit = deriveSubreddit(integration?.name);
  const { fields, append } = useFieldArray({ control, name: 'subreddit' });

  // Ensure exactly one row per integration (one subreddit per install).
  useEffect(() => {
    if (fields.length === 0) {
      append({ value: { subreddit, title: '', type: 'self' } });
    }
  }, [fields.length, append, subreddit]);

  const typeWatch = useWatch({ name: 'subreddit.0.value.type' }) as
    | 'self'
    | 'link'
    | undefined;

  if (!fields.length) return null;

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="text-[12px] opacity-70">
        {t(
          'reddit_devvit_target',
          'Posting to r/{{subreddit}}. Install the Postiz Devvit app in another subreddit to add more channels.',
          { subreddit }
        )}
      </div>

      <div className="flex gap-[8px]">
        <label className="flex-1">
          <input
            type="radio"
            value="self"
            {...register(`subreddit.0.value.type` as const)}
            defaultChecked
          />{' '}
          {t('text_post', 'Text post')}
        </label>
        <label className="flex-1">
          <input
            type="radio"
            value="link"
            {...register(`subreddit.0.value.type` as const)}
          />{' '}
          {t('link_post', 'Link post')}
        </label>
      </div>

      <Input
        label={t('title', 'Title')}
        {...register(`subreddit.0.value.title` as const, { required: true })}
      />
      <input
        type="hidden"
        value={subreddit}
        {...register(`subreddit.0.value.subreddit` as const)}
      />
      {typeWatch === 'link' && (
        <Input
          label={t('url', 'URL')}
          placeholder="https://"
          {...register(`subreddit.0.value.url` as const)}
        />
      )}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: RedditDevvitSettings,
  CustomPreviewComponent: RedditDevvitPreview,
  dto: RedditDevvitSettingsDto,
  checkValidity: async (_posts, settings: any) => {
    const entry = settings?.subreddit?.[0]?.value;
    if (!entry?.title) return 'Title is required.';
    if (entry.type === 'link' && !entry.url) return 'URL is required for link posts.';
    return true;
  },
  maximumCharacters: 10000,
});
