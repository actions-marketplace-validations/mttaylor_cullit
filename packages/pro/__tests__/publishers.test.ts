import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReleaseNotes } from '@cullit/core';

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

describe('SlackPublisher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to Slack webhook', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { SlackPublisher } = await import('../src/publishers/slack');

    const pub = new SlackPublisher('https://hooks.slack.com/test');
    await pub.publish(sampleNotes, 'markdown');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/test');
    expect(opts?.method).toBe('POST');

    const body = JSON.parse(opts?.body as string);
    expect(body.text).toContain('v2.0.0');
    expect(body.text).toContain('Add dark mode');
  });

  it('throws on webhook failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 500 })
    );
    const { SlackPublisher } = await import('../src/publishers/slack');

    const pub = new SlackPublisher('https://hooks.slack.com/test');
    await expect(pub.publish(sampleNotes, 'markdown')).rejects.toThrow('Slack webhook failed');
  });
});

describe('DiscordPublisher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to Discord webhook with embed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { DiscordPublisher } = await import('../src/publishers/discord');

    const pub = new DiscordPublisher('https://discord.com/api/webhooks/test');
    await pub.publish(sampleNotes, 'markdown');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toContain('v2.0.0');
    expect(body.embeds[0].description).toContain('Add dark mode');
  });

  it('throws on webhook failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 403 })
    );
    const { DiscordPublisher } = await import('../src/publishers/discord');

    const pub = new DiscordPublisher('https://discord.com/api/webhooks/test');
    await expect(pub.publish(sampleNotes, 'markdown')).rejects.toThrow('Discord webhook failed');
  });
});

describe('GitHubReleasePublisher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws without GITHUB_TOKEN', async () => {
    const saved = process.env['GITHUB_TOKEN'];
    delete process.env['GITHUB_TOKEN'];

    const { GitHubReleasePublisher } = await import('../src/publishers/github-release');
    const pub = new GitHubReleasePublisher();
    await expect(pub.publish(sampleNotes, 'markdown')).rejects.toThrow('GITHUB_TOKEN');

    if (saved) process.env['GITHUB_TOKEN'] = saved;
  });

  it('throws without GITHUB_REPOSITORY', async () => {
    const savedToken = process.env['GITHUB_TOKEN'];
    const savedRepo = process.env['GITHUB_REPOSITORY'];
    process.env['GITHUB_TOKEN'] = 'test-token';
    delete process.env['GITHUB_REPOSITORY'];

    const { GitHubReleasePublisher } = await import('../src/publishers/github-release');
    const pub = new GitHubReleasePublisher();
    await expect(pub.publish(sampleNotes, 'markdown')).rejects.toThrow('GITHUB_REPOSITORY');

    if (savedToken) process.env['GITHUB_TOKEN'] = savedToken;
    else delete process.env['GITHUB_TOKEN'];
    if (savedRepo) process.env['GITHUB_REPOSITORY'] = savedRepo;
  });
});
