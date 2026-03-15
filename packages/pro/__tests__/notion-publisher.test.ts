import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReleaseNotes } from '@cullit/core';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { fetchWithTimeout } from '@cullit/core';
const mockedFetch = vi.mocked(fetchWithTimeout);

const sampleNotes: ReleaseNotes = {
  version: 'v2.0.0',
  date: '2026-06-15',
  summary: 'Major release.',
  changes: [
    { description: 'Add dark mode', category: 'features', ticketKey: 'PROJ-10' },
    { description: 'Fix crash', category: 'fixes' },
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

describe('NotionPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOTION_API_KEY = 'ntn_test_key_12345';
  });

  afterEach(() => {
    delete process.env.NOTION_API_KEY;
  });

  it('rejects missing databaseId', async () => {
    const { NotionPublisher } = await import('../src/publishers/notion');
    expect(() => new NotionPublisher({ databaseId: '' }))
      .toThrow('Notion databaseId is required');
  });

  it('rejects invalid databaseId format', async () => {
    const { NotionPublisher } = await import('../src/publishers/notion');
    expect(() => new NotionPublisher({ databaseId: 'not-a-valid-id' }))
      .toThrow('Invalid Notion databaseId format');
  });

  it('accepts databaseId with dashes', async () => {
    const { NotionPublisher } = await import('../src/publishers/notion');
    expect(() => new NotionPublisher({ databaseId: '12345678-1234-1234-1234-123456789abc' }))
      .not.toThrow();
  });

  it('accepts databaseId without dashes', async () => {
    const { NotionPublisher } = await import('../src/publishers/notion');
    expect(() => new NotionPublisher({ databaseId: '123456781234123412341234567890ab' }))
      .not.toThrow();
  });

  it('throws when NOTION_API_KEY is missing', async () => {
    delete process.env.NOTION_API_KEY;
    const { NotionPublisher } = await import('../src/publishers/notion');
    expect(() => new NotionPublisher({ databaseId: '123456781234123412341234567890ab' }))
      .toThrow('NOTION_API_KEY not configured');
  });

  it('posts page with properties and blocks to Notion API', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { NotionPublisher } = await import('../src/publishers/notion');
    const pub = new NotionPublisher({ databaseId: '123456781234123412341234567890ab' });
    await pub.publish(sampleNotes, 'markdown');

    expect(mockedFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockedFetch.mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/pages');
    expect(opts?.method).toBe('POST');

    const headers = opts?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer ntn_test_key_12345');
    expect(headers['Notion-Version']).toBe('2022-06-28');

    const body = JSON.parse(opts?.body as string);
    expect(body.parent.database_id).toBe('123456781234123412341234567890ab');
    expect(body.properties.Name.title[0].text.content).toContain('v2.0.0');
    expect(body.properties.Version.rich_text[0].text.content).toBe('v2.0.0');
    expect(body.properties.Changes.number).toBe(2);
  });

  it('builds content blocks with categories', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { NotionPublisher } = await import('../src/publishers/notion');
    const pub = new NotionPublisher({ databaseId: '123456781234123412341234567890ab' });
    await pub.publish(sampleNotes, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[0][1]?.body as string);
    const blocks = body.children;

    // Should have: summary paragraph, heading+items for features, heading+items for fixes, footer
    const headings = blocks.filter((b: any) => b.type === 'heading_3');
    expect(headings.length).toBeGreaterThanOrEqual(2);

    const items = blocks.filter((b: any) => b.type === 'bulleted_list_item');
    expect(items).toHaveLength(2);

    // Ticket key in bulleted item
    const featureItem = items.find((i: any) =>
      i.bulleted_list_item.rich_text[0].text.content.includes('dark mode')
    );
    expect(featureItem.bulleted_list_item.rich_text[0].text.content).toContain('PROJ-10');
  });

  it('throws on API failure', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as any);

    const { NotionPublisher } = await import('../src/publishers/notion');
    const pub = new NotionPublisher({ databaseId: '123456781234123412341234567890ab' });
    await expect(pub.publish(sampleNotes, 'markdown')).rejects.toThrow('Notion API failed (401)');
  });

  it('handles notes without summary', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const minimal: ReleaseNotes = {
      version: 'v1.0.0',
      date: '2026-01-01',
      changes: [{ description: 'Init', category: 'features' }],
      contributors: [],
    };

    const { NotionPublisher } = await import('../src/publishers/notion');
    const pub = new NotionPublisher({ databaseId: '123456781234123412341234567890ab' });
    await pub.publish(minimal, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[0][1]?.body as string);
    // No summary paragraph — first block should be heading_3
    expect(body.children[0].type).toBe('heading_3');
  });
});
