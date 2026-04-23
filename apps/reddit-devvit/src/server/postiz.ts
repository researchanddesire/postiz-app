// Tiny Postiz API client used from within the Devvit server handlers.
// Postiz base URL is compiled in from an env var at build time; update devvit.json
// permissions.http.domains to match.

export interface PostizJob {
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

export class PostizClient {
  constructor(
    private readonly baseUrl: string,
    private readonly integrationToken: string
  ) {}

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.integrationToken}`,
    };
  }

  async pair(input: {
    code: string;
    subredditName: string;
    redditUsername: string;
  }): Promise<{ integrationToken: string; integrationId: string; subreddit: string }> {
    const res = await fetch(`${this.baseUrl}/public/reddit-devvit/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(`pair failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async pending(): Promise<PostizJob[]> {
    const res = await fetch(`${this.baseUrl}/public/reddit-devvit/pending`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`pending failed: ${res.status}`);
    }
    const data = (await res.json()) as { jobs: PostizJob[] };
    return data.jobs ?? [];
  }

  async reportResult(input: {
    jobId: string;
    redditPostId?: string;
    permalink?: string;
    error?: string;
  }): Promise<void> {
    const res = await fetch(`${this.baseUrl}/public/reddit-devvit/result`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(`result failed: ${res.status}`);
    }
  }
}
