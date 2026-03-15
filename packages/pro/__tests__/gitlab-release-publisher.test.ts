import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReleaseNotes } from '@cullit/core';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn(), formatNotes: vi.fn().mockReturnValue('**formatted**') };
});

import { fetchWithTimeout } from '@cullit/core';
const mockedFetch = vi.mocked(fetchWithTimeout);

const sampleNotes: ReleaseNotes = {
  version: 'v2.0.0',
  date: '2026-06-15',
  summary: 'Major release.',
  changes: [{ description: 'Add feature', category: 'features' }],
  contributors: ['matt'],
  metadata: {
    commitCount: 8,
    prCount: 2,
    ticketCount: 1,
    generatedBy: 'cull',
    generatedAt: '2026-06-15T10:00:00Z',
  },
};

describe('GitLabReleasePublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITLAB_TOKEN = 'glpat-test-token';
    process.env.GITLAB_PROJECT_ID = '12345';
  });

  afterEach(() => {
    delete process.env.GITLAB_TOKEN;
    delete process.env.GITLAB_PROJECT_ID;
    delete process.env.GITLAB_DOMAIN;
  });

  it('throws when GITLAB_TOKEN is missing', async () => {
    delete process.env.GITLAB_TOKEN;
    const { GitLabReleasePublisher } = await import('../src/publishers/gitlab-release');
    expect(() => new GitLabReleasePublisher()).toThrow('GITLAB_TOKEN is required');
  });

  it('throws when project ID is missing', async () => {
    delete process.env.GITLAB_PROJECT_ID;
    const { GitLabReleasePublisher } = await import('../src/publishers/gitlab-release');
    expect(() => new GitLabReleasePublisher()).toThrow('GitLab project ID is required');
  });

  it('creates a new release when none exists', async () => {
    // getRelease returns 404
    mockedFetch.mockResolvedValueOnce({ ok: false } as any);
    // createRelease succeeds
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { GitLabReleasePublisher } = await import('../src/publishers/gitlab-release');
    const pub = new GitLabReleasePublisher();
    await pub.publish(sampleNotes, 'markdown');

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const [url, opts] = mockedFetch.mock.calls[1];
    expect(url).toContain('gitlab.com/api/v4/projects/12345/releases');
    expect(opts?.method).toBe('POST');
    const body = JSON.parse(opts?.body as string);
    expect(body.tag_name).toBe('v2.0.0');
    expect(body.name).toContain('v2.0.0');
  });

  it('updates an existing release', async () => {
    // getRelease returns 200
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    // updateRelease succeeds
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { GitLabReleasePublisher } = await import('../src/publishers/gitlab-release');
    const pub = new GitLabReleasePublisher();
    await pub.publish(sampleNotes, 'markdown');

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const [url, opts] = mockedFetch.mock.calls[1];
    expect(url).toContain('v2.0.0');
    expect(opts?.method).toBe('PUT');
  });

  it('uses config domain for self-hosted GitLab', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: false } as any);
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { GitLabReleasePublisher } = await import('../src/publishers/gitlab-release');
    const pub = new GitLabReleasePublisher({ domain: 'gitlab.mycompany.com', projectId: '99' });
    await pub.publish(sampleNotes, 'markdown');

    const [url] = mockedFetch.mock.calls[0];
    expect(url).toContain('gitlab.mycompany.com');
  });

  it('prepends v to version without it', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: false } as any);
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const notes = { ...sampleNotes, version: '2.0.0' }; // no 'v' prefix

    const { GitLabReleasePublisher } = await import('../src/publishers/gitlab-release');
    const pub = new GitLabReleasePublisher();
    await pub.publish(notes, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[1][1]?.body as string);
    expect(body.tag_name).toBe('v2.0.0');
  });

  it('throws on create failure', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: false } as any);
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => 'Tag already exists',
    } as any);

    const { GitLabReleasePublisher } = await import('../src/publishers/gitlab-release');
    const pub = new GitLabReleasePublisher();
    await expect(pub.publish(sampleNotes, 'markdown')).rejects.toThrow('GitLab Release creation failed');
  });
});
