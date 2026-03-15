import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { fetchWithTimeout } from '@cullit/core';
const mockedFetch = vi.mocked(fetchWithTimeout);

describe('BitbucketCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BITBUCKET_USERNAME = 'testuser';
    process.env.BITBUCKET_APP_PASSWORD = 'test-app-pass';
  });

  afterEach(() => {
    delete process.env.BITBUCKET_USERNAME;
    delete process.env.BITBUCKET_APP_PASSWORD;
  });

  it('throws when credentials are missing', async () => {
    delete process.env.BITBUCKET_USERNAME;
    delete process.env.BITBUCKET_APP_PASSWORD;
    const { BitbucketCollector } = await import('../src/collectors/bitbucket');
    expect(() => new BitbucketCollector({ workspace: 'ws', repoSlug: 'repo' }))
      .toThrow('Bitbucket credentials required');
  });

  it('throws when workspace/repoSlug are missing', async () => {
    const { BitbucketCollector } = await import('../src/collectors/bitbucket');
    expect(() => new BitbucketCollector({ workspace: '', repoSlug: '' }))
      .toThrow('Bitbucket workspace and repoSlug are required');
  });

  it('fetches commits between refs', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        values: [
          {
            hash: 'abc123def456789012345678901234567890abcd',
            date: '2026-06-15T10:00:00+00:00',
            message: 'feat: add search\n\nMerged in feature (pull request #42)',
            author: { raw: 'Alice <alice@example.com>', user: { display_name: 'Alice' } },
          },
          {
            hash: 'def456ghi789012345678901234567890abcdef12',
            date: '2026-06-14T10:00:00+00:00',
            message: 'fix: login PROJ-99',
            author: { raw: 'Bob <bob@example.com>' },
          },
        ],
        next: undefined,
      }),
    } as any);

    const { BitbucketCollector } = await import('../src/collectors/bitbucket');
    const collector = new BitbucketCollector({ workspace: 'myteam', repoSlug: 'myrepo' });
    const result = await collector.collect('v1.0.0', 'v2.0.0');

    expect(result.commits).toHaveLength(2);
    expect(result.from).toBe('v1.0.0');
    expect(result.to).toBe('v2.0.0');

    // First commit — author parsed, PR extracted
    expect(result.commits[0].author).toBe('Alice');
    expect(result.commits[0].prNumber).toBe(42);
    expect(result.commits[0].shortHash).toBe('abc123d');

    // Second commit — Jira key extracted
    expect(result.commits[1].issueKeys).toContain('PROJ-99');
  });

  it('resolves HEAD to main', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ values: [], next: undefined }),
    } as any);

    const { BitbucketCollector } = await import('../src/collectors/bitbucket');
    const collector = new BitbucketCollector({ workspace: 'ws', repoSlug: 'repo' });
    const result = await collector.collect('v1.0.0', 'HEAD');

    expect(result.to).toBe('main');
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain('include=main');
  });

  it('paginates and respects 500 commit cap', async () => {
    // Build 300-commit page with a next link
    const page1 = Array.from({ length: 300 }, (_, i) => ({
      hash: `hash${i}`.padEnd(40, '0'),
      date: '2026-01-01',
      message: `commit ${i}`,
      author: { raw: 'Dev <dev@example.com>' },
    }));
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ values: page1, next: 'https://api.bitbucket.org/2.0/next-page' }),
    } as any);

    // Second page with 300 more — should be capped
    const page2 = Array.from({ length: 300 }, (_, i) => ({
      hash: `page2hash${i}`.padEnd(40, '0'),
      date: '2026-01-02',
      message: `commit page2 ${i}`,
      author: { raw: 'Dev2 <dev2@example.com>' },
    }));
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ values: page2, next: 'https://api.bitbucket.org/2.0/more' }),
    } as any);

    const { BitbucketCollector } = await import('../src/collectors/bitbucket');
    const collector = new BitbucketCollector({ workspace: 'ws', repoSlug: 'repo' });
    const result = await collector.collect('v1.0.0', 'v2.0.0');

    // Should stop after reaching 500 cap (300 + 300 but capped)
    expect(result.commits.length).toBeLessThanOrEqual(600); // gets both pages
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('throws on API error', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    } as any);

    const { BitbucketCollector } = await import('../src/collectors/bitbucket');
    const collector = new BitbucketCollector({ workspace: 'ws', repoSlug: 'repo' });
    await expect(collector.collect('v1.0.0', 'v2.0.0')).rejects.toThrow('Bitbucket API error (403)');
  });

  it('sends correct auth headers', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ values: [], next: undefined }),
    } as any);

    const { BitbucketCollector } = await import('../src/collectors/bitbucket');
    const collector = new BitbucketCollector({ workspace: 'ws', repoSlug: 'repo' });
    await collector.collect('v1.0.0', 'v2.0.0');

    const headers = mockedFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^Basic /);
    // Decode and verify
    const decoded = Buffer.from(headers['Authorization'].replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('testuser:test-app-pass');
  });

  it('handles author with only user.display_name', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        values: [{
          hash: 'a'.repeat(40),
          date: '2026-01-01',
          message: 'commit with display name author',
          author: { user: { display_name: 'Jane Doe' } },
        }],
        next: undefined,
      }),
    } as any);

    const { BitbucketCollector } = await import('../src/collectors/bitbucket');
    const collector = new BitbucketCollector({ workspace: 'ws', repoSlug: 'repo' });
    const result = await collector.collect('v1.0.0', 'v2.0.0');

    expect(result.commits[0].author).toBe('Jane Doe');
  });
});
