import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  summary: 'Major release with new features.',
  changes: [
    { description: 'Add dark mode', category: 'features', ticketKey: 'PROJ-10' },
    { description: 'Fix login crash', category: 'fixes' },
    { description: 'Remove legacy API', category: 'breaking' },
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

describe('TeamsPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid webhook URL', async () => {
    const { TeamsPublisher } = await import('../src/publishers/teams');
    expect(() => new TeamsPublisher('https://example.com/webhook'))
      .toThrow('Invalid Teams webhook URL');
  });

  it('rejects non-HTTPS webhook URL', async () => {
    const { TeamsPublisher } = await import('../src/publishers/teams');
    expect(() => new TeamsPublisher('http://test.webhook.office.com/path'))
      .toThrow('Invalid Teams webhook URL');
  });

  it('accepts valid webhook URL', async () => {
    const { TeamsPublisher } = await import('../src/publishers/teams');
    expect(() => new TeamsPublisher('https://myorg.webhook.office.com/webhookb2/abc'))
      .not.toThrow();
  });

  it('posts Adaptive Card to Teams webhook', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { TeamsPublisher } = await import('../src/publishers/teams');

    const pub = new TeamsPublisher('https://myorg.webhook.office.com/webhookb2/abc');
    await pub.publish(sampleNotes, 'markdown');

    expect(mockedFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockedFetch.mock.calls[0];
    expect(url).toBe('https://myorg.webhook.office.com/webhookb2/abc');
    expect(opts?.method).toBe('POST');

    const body = JSON.parse(opts?.body as string);
    expect(body.type).toBe('message');
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');

    const card = body.attachments[0].content;
    expect(card.type).toBe('AdaptiveCard');
    expect(card.body[0].text).toContain('v2.0.0');
  });

  it('includes all changes with correct emoji', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { TeamsPublisher } = await import('../src/publishers/teams');

    const pub = new TeamsPublisher('https://myorg.webhook.office.com/webhookb2/abc');
    await pub.publish(sampleNotes, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[0][1]?.body as string);
    const card = body.attachments[0].content;
    const texts = card.body.map((b: any) => b.text).filter(Boolean);

    expect(texts.some((t: string) => t.includes('✨') && t.includes('Add dark mode'))).toBe(true);
    expect(texts.some((t: string) => t.includes('🐛') && t.includes('Fix login crash'))).toBe(true);
    expect(texts.some((t: string) => t.includes('⚠️') && t.includes('Remove legacy API'))).toBe(true);
  });

  it('includes ticket keys in change text', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { TeamsPublisher } = await import('../src/publishers/teams');

    const pub = new TeamsPublisher('https://myorg.webhook.office.com/webhookb2/abc');
    await pub.publish(sampleNotes, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[0][1]?.body as string);
    const card = body.attachments[0].content;
    const texts = card.body.map((b: any) => b.text).filter(Boolean);

    expect(texts.some((t: string) => t.includes('PROJ-10'))).toBe(true);
  });

  it('throws on webhook failure', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: false, status: 429 } as any);
    const { TeamsPublisher } = await import('../src/publishers/teams');

    const pub = new TeamsPublisher('https://myorg.webhook.office.com/webhookb2/abc');
    await expect(pub.publish(sampleNotes, 'markdown')).rejects.toThrow('Teams webhook failed (429)');
  });

  it('handles notes without summary or metadata', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { TeamsPublisher } = await import('../src/publishers/teams');

    const minimalNotes: ReleaseNotes = {
      version: 'v1.0.0',
      date: '2026-01-01',
      changes: [{ description: 'Initial release', category: 'features' }],
      contributors: [],
    };

    const pub = new TeamsPublisher('https://myorg.webhook.office.com/webhookb2/abc');
    await pub.publish(minimalNotes, 'markdown');

    const body = JSON.parse(mockedFetch.mock.calls[0][1]?.body as string);
    const card = body.attachments[0].content;
    // Should not crash without summary/metadata
    expect(card.body[0].text).toContain('v1.0.0');
  });
});
