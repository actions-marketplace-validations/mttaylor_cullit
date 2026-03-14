import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JiraEnricher } from '../src/enrichers/jira';
import type { GitDiff } from '@cullit/core';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { fetchWithTimeout } from '@cullit/core';
const mockedFetch = vi.mocked(fetchWithTimeout);

const makeDiff = (issueKeys: string[][] = [['PROJ-1']]): GitDiff => ({
  from: 'v1',
  to: 'v2',
  commits: issueKeys.map((keys, i) => ({
    hash: `hash${i}`,
    shortHash: `h${i}`,
    author: 'alice',
    date: '2026-01-01',
    message: `fix: ${keys.join(' ')}`,
    issueKeys: keys,
  })),
});

describe('JiraEnricher', () => {
  const config = { domain: 'test.atlassian.net' };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JIRA_EMAIL = 'test@example.com';
    process.env.JIRA_API_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
  });

  it('enriches commits with Jira ticket data', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        fields: {
          summary: 'Login page crashes',
          issuetype: { name: 'Bug' },
          labels: ['critical'],
          priority: { name: 'High' },
          status: { name: 'Done' },
        },
      }),
    } as any);

    const enricher = new JiraEnricher(config);
    const tickets = await enricher.enrich(makeDiff());

    expect(tickets).toHaveLength(1);
    expect(tickets[0].key).toBe('PROJ-1');
    expect(tickets[0].title).toBe('Login page crashes');
    expect(tickets[0].type).toBe('bug');
    expect(tickets[0].source).toBe('jira');
  });

  it('returns empty array when no issue keys', async () => {
    const diff: GitDiff = {
      from: 'v1',
      to: 'v2',
      commits: [{ hash: 'a', shortHash: 'a', author: 'bob', date: '2026-01-01', message: 'chore: bump deps', issueKeys: [] }],
    };

    const enricher = new JiraEnricher(config);
    const tickets = await enricher.enrich(diff);
    expect(tickets).toHaveLength(0);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('deduplicates issue keys across commits', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        fields: { summary: 'Test', issuetype: { name: 'Task' }, labels: [], priority: null, status: { name: 'Done' } },
      }),
    } as any);

    const diff = makeDiff([['PROJ-1'], ['PROJ-1']]);
    const enricher = new JiraEnricher(config);
    const tickets = await enricher.enrich(diff);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(tickets).toHaveLength(1);
  });

  it('skips 404 tickets gracefully', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockResolvedValueOnce({ ok: false, status: 404 } as any);

    const enricher = new JiraEnricher(config);
    const tickets = await enricher.enrich(makeDiff());
    expect(tickets).toHaveLength(0);
  });

  it('throws without credentials', async () => {
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;

    const enricher = new JiraEnricher(config);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tickets = await enricher.enrich(makeDiff());
    expect(tickets).toHaveLength(0);
  });
});
