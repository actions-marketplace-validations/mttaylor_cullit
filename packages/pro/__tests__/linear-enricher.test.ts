import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinearEnricher } from '../src/enrichers/linear';
import type { GitDiff } from '@cullit/core';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { fetchWithTimeout } from '@cullit/core';
const mockedFetch = vi.mocked(fetchWithTimeout);

const makeDiff = (issueKeys: string[][] = [['ENG-10']]): GitDiff => ({
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

describe('LinearEnricher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LINEAR_API_KEY = 'lin_test_key';
  });

  afterEach(() => {
    delete process.env.LINEAR_API_KEY;
  });

  it('throws without API key', () => {
    delete process.env.LINEAR_API_KEY;
    expect(() => new LinearEnricher()).toThrow('Linear API key');
  });

  it('batch fetches linear issues', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          issues: {
            nodes: [{
              identifier: 'ENG-10',
              title: 'Fix caching',
              description: 'Improve cache invalidation',
              priority: 2,
              state: { name: 'Done' },
              labels: { nodes: [{ name: 'bug' }] },
            }],
          },
        },
      }),
    } as any);

    const enricher = new LinearEnricher();
    const tickets = await enricher.enrich(makeDiff());

    expect(tickets).toHaveLength(1);
    expect(tickets[0].key).toBe('ENG-10');
    expect(tickets[0].title).toBe('Fix caching');
    expect(tickets[0].priority).toBe('high');
    expect(tickets[0].source).toBe('linear');
  });

  it('returns empty array when no issue keys', async () => {
    const diff: GitDiff = {
      from: 'v1',
      to: 'v2',
      commits: [{ hash: 'a', shortHash: 'a', author: 'bob', date: '2026-01-01', message: 'chore: deps', issueKeys: [] }],
    };

    const enricher = new LinearEnricher();
    const tickets = await enricher.enrich(diff);
    expect(tickets).toHaveLength(0);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('falls back to individual queries on batch failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal error',
    } as any);

    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          issueSearch: {
            nodes: [{
              identifier: 'ENG-10',
              title: 'Fix it',
              priority: 3,
              state: { name: 'Done' },
              labels: { nodes: [] },
            }],
          },
        },
      }),
    } as any);

    const enricher = new LinearEnricher();
    const tickets = await enricher.enrich(makeDiff());

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].key).toBe('ENG-10');
  });

  it('uses parameterized graphql variables for batch', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issues: { nodes: [] } } }),
    } as any);

    const enricher = new LinearEnricher();
    await enricher.enrich(makeDiff([['ENG-10'], ['ENG-20']]));

    const body = JSON.parse(mockedFetch.mock.calls[0][1]?.body as string);
    expect(body.variables.filter.identifier.in).toEqual(['ENG-10', 'ENG-20']);
    expect(body.query).toContain('$filter: IssueFilter!');
  });
});
