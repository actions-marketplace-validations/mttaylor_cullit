import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReleaseNotes } from '@cullit/core';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn(), formatNotes: vi.fn().mockReturnValue('formatted') };
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

describe('ChangelogPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CULLIT_API_KEY = 'clt_testkey123456789012345678901234';
  });

  afterEach(() => {
    delete process.env.CULLIT_API_KEY;
    delete process.env.CULLIT_CHANGELOG_URL;
  });

  it('throws when CULLIT_API_KEY is missing', async () => {
    delete process.env.CULLIT_API_KEY;
    const { ChangelogPublisher } = await import('../src/publishers/changelog');
    expect(() => new ChangelogPublisher()).toThrow('CULLIT_API_KEY is required');
  });

  it('posts to default API URL', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: 'https://cullit.io/changelog/my-project' }),
    } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { ChangelogPublisher } = await import('../src/publishers/changelog');
    const pub = new ChangelogPublisher();
    await pub.publish(sampleNotes, 'markdown');

    expect(mockedFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockedFetch.mock.calls[0];
    expect(url).toBe('https://api.cullit.io/v1/changelog');
    expect(opts?.method).toBe('POST');

    const headers = opts?.headers as Record<string, string>;
    expect(headers['Authorization']).toContain('Bearer');
  });

  it('sends correct payload structure', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { ChangelogPublisher } = await import('../src/publishers/changelog');
    const pub = new ChangelogPublisher({ project: 'my-app' });
    await pub.publish(sampleNotes, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[0][1]?.body as string);
    expect(body.project).toBe('my-app');
    expect(body.version).toBe('v2.0.0');
    expect(body.date).toBe('2026-06-15');
    expect(body.changes).toHaveLength(1);
    expect(body.formatted).toBeDefined();
    expect(body.formatted.markdown).toBeDefined();
    expect(body.formatted.html).toBeDefined();
  });

  it('uses custom CULLIT_CHANGELOG_URL', async () => {
    process.env.CULLIT_CHANGELOG_URL = 'https://custom.api.example.com/changelog';
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { ChangelogPublisher } = await import('../src/publishers/changelog');
    const pub = new ChangelogPublisher();
    await pub.publish(sampleNotes, 'markdown');

    expect(mockedFetch.mock.calls[0][0]).toBe('https://custom.api.example.com/changelog');
  });

  it('defaults project to "default"', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { ChangelogPublisher } = await import('../src/publishers/changelog');
    const pub = new ChangelogPublisher();
    await pub.publish(sampleNotes, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[0][1]?.body as string);
    expect(body.project).toBe('default');
  });

  it('throws on API failure', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as any);

    const { ChangelogPublisher } = await import('../src/publishers/changelog');
    const pub = new ChangelogPublisher();
    await expect(pub.publish(sampleNotes, 'markdown')).rejects.toThrow('Changelog publish failed (500)');
  });
});
