import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { fetchWithTimeout } from '@cullit/core';
const mockedFetch = vi.mocked(fetchWithTimeout);

describe('GitLabCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITLAB_TOKEN = 'glpat-test-token';
  });

  afterEach(() => {
    delete process.env.GITLAB_TOKEN;
  });

  it('throws when GITLAB_TOKEN is missing', async () => {
    delete process.env.GITLAB_TOKEN;
    const { GitLabCollector } = await import('../src/collectors/gitlab');
    expect(() => new GitLabCollector({ projectId: '123' })).toThrow('GITLAB_TOKEN is required');
  });

  it('throws when projectId is missing', async () => {
    const { GitLabCollector } = await import('../src/collectors/gitlab');
    expect(() => new GitLabCollector({ projectId: '' })).toThrow('GitLab projectId is required');
  });

  it('fetches commits and merge requests', async () => {
    // Compare endpoint
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        commits: [
          {
            id: 'abc123def456',
            short_id: 'abc123d',
            title: 'feat: add dark mode PROJ-42',
            message: 'feat: add dark mode PROJ-42\n\nDetailed description',
            author_name: 'Alice',
            authored_date: '2026-06-15T10:00:00Z',
          },
          {
            id: 'def456ghi789',
            short_id: 'def456g',
            title: 'fix: login crash #15',
            message: 'fix: login crash #15',
            author_name: 'Bob',
            authored_date: '2026-06-14T10:00:00Z',
          },
        ],
      }),
    } as any);

    // MR endpoint
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        {
          iid: 42,
          title: 'Dark mode MR',
          merge_commit_sha: 'abc123def456',
        },
      ]),
    } as any);

    const { GitLabCollector } = await import('../src/collectors/gitlab');
    const collector = new GitLabCollector({ projectId: '123' });
    const result = await collector.collect('v1.0.0', 'v2.0.0');

    expect(result.commits).toHaveLength(2);
    expect(result.from).toBe('v1.0.0');
    expect(result.to).toBe('v2.0.0');

    // First commit matched with MR
    expect(result.commits[0].hash).toBe('abc123def456');
    expect(result.commits[0].prNumber).toBe(42);
    expect(result.commits[0].author).toBe('Alice');

    // Issue keys extracted
    expect(result.commits[0].issueKeys).toContain('PROJ-42');
    expect(result.commits[1].issueKeys).toContain('#15');
  });

  it('resolves HEAD to main', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ commits: [] }),
    } as any);
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([]),
    } as any);

    const { GitLabCollector } = await import('../src/collectors/gitlab');
    const collector = new GitLabCollector({ projectId: '123' });
    const result = await collector.collect('v1.0.0', 'HEAD');

    expect(result.to).toBe('main');
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain('to=main');
  });

  it('uses custom domain for self-hosted', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ commits: [] }),
    } as any);
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([]),
    } as any);

    const { GitLabCollector } = await import('../src/collectors/gitlab');
    const collector = new GitLabCollector({ domain: 'git.internal.co', projectId: '99' });
    await collector.collect('v1.0.0', 'v2.0.0');

    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain('git.internal.co');
  });

  it('throws on API error', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as any);

    const { GitLabCollector } = await import('../src/collectors/gitlab');
    const collector = new GitLabCollector({ projectId: '123' });
    await expect(collector.collect('v1.0.0', 'v2.0.0')).rejects.toThrow('GitLab API error (401)');
  });

  it('gracefully handles MR fetch failure', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        commits: [{
          id: 'abc123',
          short_id: 'abc',
          title: 'feat: something',
          message: 'feat: something',
          author_name: 'Alice',
          authored_date: '2026-06-15',
        }],
      }),
    } as any);
    // MR endpoint fails
    mockedFetch.mockResolvedValueOnce({ ok: false } as any);

    const { GitLabCollector } = await import('../src/collectors/gitlab');
    const collector = new GitLabCollector({ projectId: '123' });
    const result = await collector.collect('v1.0.0', 'v2.0.0');

    // Should still return commits even without MR data
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].prNumber).toBeUndefined();
  });

  it('sends correct auth headers', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ commits: [] }),
    } as any);
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([]),
    } as any);

    const { GitLabCollector } = await import('../src/collectors/gitlab');
    const collector = new GitLabCollector({ projectId: '123' });
    await collector.collect('v1.0.0', 'v2.0.0');

    const headers = mockedFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['PRIVATE-TOKEN']).toBe('glpat-test-token');
  });
});
