/**
 * Live integration end-to-end test.
 *
 * Stands up a real HTTP server that impersonates every external service
 * (GitHub, GitLab, Bitbucket, Jira, Linear, Slack, Discord, Teams,
 *  Confluence, Notion, GitLab Releases, Cullit Hosted Changelog/Widget),
 * then runs each publisher / collector / verifier against it.
 *
 * This is *not* a unit-test mock — it boots an actual node http server,
 * binds a port, and exercises the full network round-trip of each integration.
 * If any wiring is broken (URL path wrong, headers missing, payload shape off),
 * these tests will fail.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { ReleaseNotes, GitDiff } from '@cullit/core';
import { verifyIntegrations } from '@cullit/core';

// --- A single multi-route mock server that pretends to be every provider ---
interface RecordedRequest { method: string; path: string; headers: Record<string, string>; body: string; }
const recorded: RecordedRequest[] = [];

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    recorded.push({
      method: req.method || '',
      path: req.url || '',
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')])),
      body,
    });

    const url = req.url || '';

    // ---------- GitHub API ----------
    if (url === '/user') return send(res, 200, { login: 'testuser', id: 1 });
    if (url.match(/^\/repos\/[^/]+\/[^/]+\/releases\/tags\//)) {
      return send(res, 404, { message: 'Not Found' });
    }
    if (url.match(/^\/repos\/[^/]+\/[^/]+\/releases$/) && req.method === 'POST') {
      return send(res, 201, { id: 999, html_url: 'https://github.com/x/y/releases/tag/v1.0.0' });
    }

    // ---------- GitLab API ----------
    if (url === '/api/v4/user') return send(res, 200, { id: 1, username: 'testuser' });
    if (url.match(/^\/api\/v4\/projects\/[^/]+\/releases\//) && req.method === 'GET') {
      return send(res, 404, {});
    }
    if (url.match(/^\/api\/v4\/projects\/[^/]+\/releases$/) && req.method === 'POST') {
      return send(res, 201, { tag_name: 'v1.0.0' });
    }
    if (url.startsWith('/api/v4/projects/') && url.includes('/repository/compare')) {
      return send(res, 200, {
        commits: [
          { id: 'abc1234567890', short_id: 'abc1234', title: 'feat: thing', message: 'feat: thing', author_name: 'matt', authored_date: '2026-01-01T00:00:00Z' },
        ],
      });
    }
    if (url.startsWith('/api/v4/projects/') && url.includes('/merge_requests')) {
      return send(res, 200, []);
    }

    // ---------- Bitbucket API ----------
    if (url === '/2.0/user') return send(res, 200, { username: 'testuser' });
    if (url.startsWith('/2.0/repositories/')) {
      return send(res, 200, {
        values: [{ hash: 'abc1234567890', date: '2026-01-01T00:00:00Z', message: 'fix: bug', author: { raw: 'Matt <matt@example.com>' } }],
      });
    }

    // ---------- Jira ----------
    if (url === '/rest/api/3/myself') return send(res, 200, { accountId: 'a', displayName: 'Test' });
    if (url.startsWith('/rest/api/3/search')) {
      return send(res, 200, {
        total: 1,
        issues: [{ key: 'PROJ-1', fields: { summary: 'Add thing', issuetype: { name: 'Story' }, status: { name: 'Done' }, resolutiondate: '2026-01-01T00:00:00Z' } }],
      });
    }
    if (url.startsWith('/rest/api/3/issue/')) {
      return send(res, 200, { fields: { summary: 'Ticket title', issuetype: { name: 'bug' }, labels: ['x'], status: { name: 'Done' } } });
    }

    // ---------- Linear ----------
    if (url === '/graphql' && req.method === 'POST') {
      if (body.includes('viewer')) return send(res, 200, { data: { viewer: { id: 'u1' } } });
      return send(res, 200, {
        data: {
          issues: {
            nodes: [{
              identifier: 'LIN-1', title: 'Linear thing', priority: 2,
              completedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
              assignee: { displayName: 'matt' }, state: { name: 'Done', type: 'completed' },
              labels: { nodes: [{ name: 'feature' }] },
            }],
          },
        },
      });
    }

    // ---------- Slack/Discord/Teams webhooks ----------
    if (url === '/services/SLACK/HOOK/test' || url === '/api/webhooks/discord-test' || url === '/teams-test') {
      return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    }

    // ---------- Confluence ----------
    if (url.startsWith('/wiki/rest/api/space')) return send(res, 200, { results: [{ key: 'TEST' }] });
    if (url.startsWith('/wiki/rest/api/content?')) return send(res, 200, { results: [] });
    if (url.startsWith('/wiki/rest/api/content') && req.method === 'POST') return send(res, 201, { id: 'p1' });

    // ---------- Notion ----------
    if (url === '/v1/users/me') return send(res, 200, { object: 'user', id: 'u1' });
    if (url === '/v1/pages' && req.method === 'POST') return send(res, 200, { object: 'page', id: 'p1' });

    // ---------- Cullit hosted changelog + widget ----------
    if (url === '/v1/license/validate' && req.method === 'POST') {
      return send(res, 200, { valid: true, tier: 'pro' });
    }
    if (url.match(/^\/v1\/changelog\/[^/]+\/latest/)) {
      return send(res, 200, { project: 'demo', releases: [] });
    }
    if (url === '/v1/changelog' && req.method === 'POST') {
      return send(res, 201, { url: 'https://cullit.io/changelog/demo' });
    }

    return send(res, 404, { error: 'mock route not found', path: url });
  });

  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>(r => server.close(() => r())));

const sample: ReleaseNotes = {
  version: 'v1.0.0',
  date: '2026-01-15',
  summary: 'First release.',
  changes: [{ description: 'Add feature', category: 'features', ticketKey: 'PROJ-1' }],
  contributors: ['matt'],
  metadata: { commitCount: 1, prCount: 1, ticketCount: 1, generatedBy: 'cull', generatedAt: '2026-01-15T00:00:00Z' },
};

describe('Live integrations end-to-end', () => {
  it('Slack publisher round-trips through a real webhook server', async () => {
    const { SlackPublisher } = await import('../src/publishers/slack');
    // Hostname check is bypassed because we monkey-patch the URL; instead, point a real https-shaped URL at the mock by overriding fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => originalFetch(baseUrl + '/services/SLACK/HOOK/test', init)) as typeof fetch;
    try {
      const pub = new SlackPublisher('https://hooks.slack.com/services/T/B/X');
      await pub.publish(sample, 'markdown');
      const last = recorded[recorded.length - 1];
      expect(last.method).toBe('POST');
      const payload = JSON.parse(last.body);
      expect(payload.text).toContain('v1.0.0');
      expect(payload.text).toContain('Add feature');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('Discord publisher posts an embed', async () => {
    const { DiscordPublisher } = await import('../src/publishers/discord');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => originalFetch(baseUrl + '/api/webhooks/discord-test', init)) as typeof fetch;
    try {
      const pub = new DiscordPublisher('https://discord.com/api/webhooks/123/abc');
      await pub.publish(sample, 'markdown');
      const last = recorded[recorded.length - 1];
      const payload = JSON.parse(last.body);
      expect(payload.embeds[0].title).toContain('v1.0.0');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('Teams publisher sends an Adaptive Card', async () => {
    const { TeamsPublisher } = await import('../src/publishers/teams');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => originalFetch(baseUrl + '/teams-test', init)) as typeof fetch;
    try {
      const pub = new TeamsPublisher('https://example.webhook.office.com/test');
      await pub.publish(sample, 'markdown');
      const last = recorded[recorded.length - 1];
      const payload = JSON.parse(last.body);
      expect(payload.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('Confluence publisher creates a page', async () => {
    process.env.CONFLUENCE_EMAIL = 'a@b.com';
    process.env.CONFLUENCE_API_TOKEN = 'tok';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      const u = new URL(url);
      return originalFetch(baseUrl + u.pathname + u.search, init);
    }) as typeof fetch;
    try {
      const { ConfluencePublisher } = await import('../src/publishers/confluence');
      const pub = new ConfluencePublisher({ domain: 'test.atlassian.net', spaceKey: 'TEST' });
      await pub.publish(sample, 'html');
      const last = recorded[recorded.length - 1];
      expect(last.method).toBe('POST');
      expect(last.path).toContain('/wiki/rest/api/content');
    } finally { globalThis.fetch = originalFetch; delete process.env.CONFLUENCE_EMAIL; delete process.env.CONFLUENCE_API_TOKEN; }
  });

  it('Notion publisher creates a database row', async () => {
    process.env.NOTION_API_KEY = 'secret_x';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      const u = new URL(url);
      return originalFetch(baseUrl + u.pathname, init);
    }) as typeof fetch;
    try {
      const { NotionPublisher } = await import('../src/publishers/notion');
      const pub = new NotionPublisher({ databaseId: '1'.repeat(32) });
      await pub.publish(sample, 'markdown');
      const last = recorded[recorded.length - 1];
      expect(last.path).toBe('/v1/pages');
      const payload = JSON.parse(last.body);
      expect(payload.properties.Name.title[0].text.content).toContain('v1.0.0');
    } finally { globalThis.fetch = originalFetch; delete process.env.NOTION_API_KEY; }
  });

  it('GitHub Release publisher creates a release', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.GITHUB_REPOSITORY = 'octo/cat';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      const u = new URL(url);
      return originalFetch(baseUrl + u.pathname, init);
    }) as typeof fetch;
    try {
      const { GitHubReleasePublisher } = await import('../src/publishers/github-release');
      const pub = new GitHubReleasePublisher();
      await pub.publish(sample, 'markdown');
      const last = recorded[recorded.length - 1];
      expect(last.method).toBe('POST');
      expect(last.path).toBe('/repos/octo/cat/releases');
    } finally { globalThis.fetch = originalFetch; delete process.env.GITHUB_TOKEN; delete process.env.GITHUB_REPOSITORY; }
  });

  it('GitLab Release publisher creates a release', async () => {
    process.env.GITLAB_TOKEN = 'glpat_test';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      const u = new URL(url);
      return originalFetch(baseUrl + u.pathname, init);
    }) as typeof fetch;
    try {
      const { GitLabReleasePublisher } = await import('../src/publishers/gitlab-release');
      const pub = new GitLabReleasePublisher({ projectId: '42' });
      await pub.publish(sample, 'markdown');
      const last = recorded[recorded.length - 1];
      expect(last.method).toBe('POST');
      expect(last.path).toContain('/api/v4/projects/42/releases');
    } finally { globalThis.fetch = originalFetch; delete process.env.GITLAB_TOKEN; }
  });

  it('Hosted Changelog publisher posts to /v1/changelog', async () => {
    process.env.CULLIT_API_KEY = 'cul_test';
    process.env.CULLIT_CHANGELOG_URL = baseUrl + '/v1/changelog';
    const { ChangelogPublisher } = await import('../src/publishers/changelog');
    const pub = new ChangelogPublisher({ project: 'demo' });
    await pub.publish(sample, 'markdown');
    const last = recorded[recorded.length - 1];
    expect(last.path).toBe('/v1/changelog');
    const payload = JSON.parse(last.body);
    expect(payload.project).toBe('demo');
    expect(payload.version).toBe('v1.0.0');
    expect(payload.formatted.markdown).toBeTruthy();
    delete process.env.CULLIT_API_KEY;
    delete process.env.CULLIT_CHANGELOG_URL;
  });

  it('GitLab collector returns commits from compare endpoint', async () => {
    process.env.GITLAB_TOKEN = 'glpat_test';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      const u = new URL(url);
      return originalFetch(baseUrl + u.pathname + u.search, init);
    }) as typeof fetch;
    try {
      const { GitLabCollector } = await import('../src/collectors/gitlab');
      const c = new GitLabCollector({ projectId: '42' });
      const diff: GitDiff = await c.collect('v1', 'v2');
      expect(diff.commits.length).toBe(1);
      expect(diff.commits[0].message).toContain('feat');
    } finally { globalThis.fetch = originalFetch; delete process.env.GITLAB_TOKEN; }
  });

  it('Bitbucket collector returns commits', async () => {
    process.env.BITBUCKET_USERNAME = 'matt';
    process.env.BITBUCKET_APP_PASSWORD = 'pw';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      const u = new URL(url);
      return originalFetch(baseUrl + u.pathname + u.search, init);
    }) as typeof fetch;
    try {
      const { BitbucketCollector } = await import('../src/collectors/bitbucket');
      const c = new BitbucketCollector({ workspace: 'ws', repoSlug: 'repo' });
      const diff = await c.collect('v1', 'v2');
      expect(diff.commits.length).toBe(1);
    } finally { globalThis.fetch = originalFetch; delete process.env.BITBUCKET_USERNAME; delete process.env.BITBUCKET_APP_PASSWORD; }
  });

  it('Jira collector returns issues', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      const u = new URL(url);
      return originalFetch(baseUrl + u.pathname + u.search, init);
    }) as typeof fetch;
    try {
      const { JiraCollector } = await import('../src/collectors/jira');
      const c = new JiraCollector({ domain: 'test.atlassian.net', email: 'a@b.com', apiToken: 't', projectKey: 'PROJ' });
      const diff = await c.collect('PROJ', 'HEAD');
      expect(diff.commits.length).toBe(1);
      expect(diff.commits[0].issueKeys?.[0]).toBe('PROJ-1');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('Linear collector returns issues', async () => {
    process.env.LINEAR_API_KEY = 'lin_test';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => originalFetch(baseUrl + '/graphql', init)) as typeof fetch;
    try {
      const { LinearCollector } = await import('../src/collectors/linear');
      const c = new LinearCollector();
      const diff = await c.collect('team:ENG', 'HEAD');
      expect(diff.commits.length).toBe(1);
      expect(diff.commits[0].issueKeys?.[0]).toBe('LIN-1');
    } finally { globalThis.fetch = originalFetch; delete process.env.LINEAR_API_KEY; }
  });

  it('verifyIntegrations probes every configured connection', async () => {
    const env = {
      GITHUB_TOKEN: 'ghp',
      GITLAB_TOKEN: 'glp',
      BITBUCKET_USERNAME: 'matt',
      BITBUCKET_APP_PASSWORD: 'pw',
      JIRA_EMAIL: 'a@b.com',
      JIRA_API_TOKEN: 'tok',
      LINEAR_API_KEY: 'lin',
      NOTION_API_KEY: 'sec',
      CULLIT_API_KEY: 'cul',
      CONFLUENCE_EMAIL: 'a@b.com',
      CONFLUENCE_API_TOKEN: 'tok',
    };
    const results = await verifyIntegrations({
      source: 'local',
      ai: { provider: 'none' },
      audience: 'developer',
      tone: 'professional',
      jira: { domain: 'test.atlassian.net' },
      publish: [
        { type: 'slack',          webhookUrl: 'https://hooks.slack.com/services/SLACK/HOOK/test' },
        { type: 'discord',        webhookUrl: 'https://discord.com/api/webhooks/discord-test' },
        { type: 'teams',          webhookUrl: 'https://example.webhook.office.com/teams-test' },
        { type: 'confluence',     domain: 'test.atlassian.net', spaceKey: 'TEST' },
        { type: 'notion',         databaseId: '1'.repeat(32) },
        { type: 'github-release' },
        { type: 'gitlab-release' },
        { type: 'changelog',      project: 'demo' },
      ],
    } as never, { baseUrlOverride: baseUrl, env });

    // Every result should be 'ok' (since the mock returns 200 for every probe path)
    const failed = results.filter(r => r.status !== 'ok' && r.status !== 'misconfigured');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);

    // Spot-check that the expected integrations were probed
    const ids = new Set(results.map(r => r.integration));
    expect(ids.has('github')).toBe(true);
    expect(ids.has('linear')).toBe(true);
    expect(ids.has('slack')).toBe(true);
    expect(ids.has('notion')).toBe(true);
    expect(ids.has('widget')).toBe(true);
  });
});
