import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReleaseNotes } from '@cullit/core';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn(), formatNotes: vi.fn().mockReturnValue('<p>formatted</p>') };
});

import { fetchWithTimeout } from '@cullit/core';
const mockedFetch = vi.mocked(fetchWithTimeout);

const sampleNotes: ReleaseNotes = {
  version: 'v2.0.0',
  date: '2026-06-15',
  summary: 'Major release with new features.',
  changes: [
    { description: 'Add dark mode', category: 'features', ticketKey: 'PROJ-10' },
    { description: 'Fix login crash', category: 'fixes' },
  ],
  contributors: ['matt'],
  metadata: {
    commitCount: 8,
    prCount: 2,
    ticketCount: 1,
    generatedBy: 'cull',
    generatedAt: '2026-06-15T10:00:00Z',
  },
};

describe('ConfluencePublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONFLUENCE_EMAIL = 'user@company.com';
    process.env.CONFLUENCE_API_TOKEN = 'conf-token-123';
  });

  afterEach(() => {
    delete process.env.CONFLUENCE_EMAIL;
    delete process.env.CONFLUENCE_API_TOKEN;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
  });

  it('rejects invalid domain', async () => {
    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    expect(() => new ConfluencePublisher({ domain: 'evil.com', spaceKey: 'DEV' }))
      .toThrow('Invalid Confluence domain');
  });

  it('rejects missing domain', async () => {
    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    expect(() => new ConfluencePublisher({ domain: '', spaceKey: 'DEV' }))
      .toThrow('Invalid Confluence domain');
  });

  it('rejects invalid spaceKey', async () => {
    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    expect(() => new ConfluencePublisher({ domain: 'test.atlassian.net', spaceKey: 'bad key!' }))
      .toThrow('Invalid Confluence spaceKey');
  });

  it('rejects lowercase spaceKey', async () => {
    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    expect(() => new ConfluencePublisher({ domain: 'test.atlassian.net', spaceKey: 'dev' }))
      .toThrow('Invalid Confluence spaceKey');
  });

  it('throws when credentials are missing', async () => {
    delete process.env.CONFLUENCE_EMAIL;
    delete process.env.CONFLUENCE_API_TOKEN;
    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    expect(() => new ConfluencePublisher({ domain: 'test.atlassian.net', spaceKey: 'DEV' }))
      .toThrow('Confluence credentials not configured');
  });

  it('falls back to JIRA env vars', async () => {
    delete process.env.CONFLUENCE_EMAIL;
    delete process.env.CONFLUENCE_API_TOKEN;
    process.env.JIRA_EMAIL = 'jira@company.com';
    process.env.JIRA_API_TOKEN = 'jira-token';
    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    expect(() => new ConfluencePublisher({ domain: 'test.atlassian.net', spaceKey: 'DEV' }))
      .not.toThrow();
  });

  it('creates a new page when none exists', async () => {
    // findPage returns no results
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as any);
    // createPage succeeds
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    const pub = new ConfluencePublisher({ domain: 'test.atlassian.net', spaceKey: 'DEV' });
    await pub.publish(sampleNotes, 'markdown');

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    // Second call is createPage (POST)
    const [url, opts] = mockedFetch.mock.calls[1];
    expect(url).toContain('test.atlassian.net/wiki/rest/api/content');
    expect(opts?.method).toBe('POST');
    const body = JSON.parse(opts?.body as string);
    expect(body.title).toContain('v2.0.0');
    expect(body.space.key).toBe('DEV');
  });

  it('updates existing page', async () => {
    // findPage returns a result
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ id: 'page-123', version: { number: 3 } }],
      }),
    } as any);
    // updatePage succeeds
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    const pub = new ConfluencePublisher({ domain: 'test.atlassian.net', spaceKey: 'DEV' });
    await pub.publish(sampleNotes, 'markdown');

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const [url, opts] = mockedFetch.mock.calls[1];
    expect(url).toContain('page-123');
    expect(opts?.method).toBe('PUT');
    const body = JSON.parse(opts?.body as string);
    expect(body.version.number).toBe(4); // incremented
  });

  it('throws on create failure', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as any);
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    } as any);

    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    const pub = new ConfluencePublisher({ domain: 'test.atlassian.net', spaceKey: 'DEV' });
    await expect(pub.publish(sampleNotes, 'markdown')).rejects.toThrow('Confluence create failed (403)');
  });

  it('includes parentPageId when configured', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as any);
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    const pub = new ConfluencePublisher({
      domain: 'test.atlassian.net',
      spaceKey: 'DEV',
      parentPageId: 'parent-456',
    });
    await pub.publish(sampleNotes, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[1][1]?.body as string);
    expect(body.ancestors).toEqual([{ id: 'parent-456' }]);
  });

  it('escapes HTML in generated content', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as any);
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const xssNotes: ReleaseNotes = {
      ...sampleNotes,
      summary: '<script>alert("xss")</script>',
      changes: [{ description: 'Fix <b>bold</b> issue', category: 'fixes' }],
    };

    const { ConfluencePublisher } = await import('../src/publishers/confluence');
    const pub = new ConfluencePublisher({ domain: 'test.atlassian.net', spaceKey: 'DEV' });
    await pub.publish(xssNotes, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[1][1]?.body as string);
    const html = body.body.storage.value;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;');
  });
});
