import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinearCollector } from '../src/collectors/linear';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { fetchWithTimeout } from '@cullit/core';
const mockedFetch = vi.mocked(fetchWithTimeout);

describe('LinearCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LINEAR_API_KEY = 'lin_test_key';
  });

  afterEach(() => {
    delete process.env.LINEAR_API_KEY;
  });

  it('throws without API key', () => {
    delete process.env.LINEAR_API_KEY;
    expect(() => new LinearCollector()).toThrow('Linear API key');
  });

  it('fetches and maps team issues', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          issues: {
            nodes: [{
              identifier: 'ENG-42',
              title: 'Implement SSO',
              description: 'Add single sign-on',
              priority: 2,
              completedAt: '2026-01-15',
              updatedAt: '2026-01-15',
              assignee: { displayName: 'Bob' },
              state: { name: 'Done', type: 'completed' },
              labels: { nodes: [{ name: 'feature' }] },
              project: { name: 'Auth' },
            }],
          },
        },
      }),
    } as any);

    const collector = new LinearCollector('lin_test_key');
    const diff = await collector.collect('team:ENG', 'HEAD');

    expect(diff.commits).toHaveLength(1);
    expect(diff.commits[0].hash).toBe('ENG-42');
    expect(diff.commits[0].author).toBe('Bob');
    expect(diff.commits[0].message).toContain('Implement SSO');
    expect(diff.from).toBe('linear:team:ENG');
  });

  it('handles project filter', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issues: { nodes: [] } } }),
    } as any);

    const collector = new LinearCollector('lin_test_key');
    await collector.collect('project:Auth', 'HEAD');

    const body = JSON.parse(mockedFetch.mock.calls[0][1]?.body as string);
    expect(body.query).toContain('project');
  });

  it('throws on API error', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    } as any);

    const collector = new LinearCollector('lin_test_key');
    await expect(collector.collect('team:ENG', 'HEAD')).rejects.toThrow('Linear API error');
  });
});
