import { RedditDevvitConnect } from '@gitroom/frontend/components/launches/reddit-devvit/reddit-devvit.connect';

export const dynamic = 'force-dynamic';

export default async function Page(props: {
  searchParams: Promise<{ state?: string }>;
}) {
  const searchParams = await props.searchParams;
  return <RedditDevvitConnect state={searchParams.state || ''} />;
}
