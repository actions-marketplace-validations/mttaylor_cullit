import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JiraCollector } from '../src/collectors/jira';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { fetchWithTimeout } from '@cullit/core';
const mockedFetch = vi.mocked(fetchWithTimeout);

describe('JiraCollector', () => {
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

  it('fetches issues and maps to GitDiff', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 1,
        issues: [{
          key: 'PROJ-1',
          fields: {
            summary: 'Add login page',
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alice' },
            status: { name: 'Done' },
            resolutiondate: '2026-01-15',
            updated: '2026-01-15',
            description: null,
            labels: ['frontend'],
            priority: { name: 'High' },
          },
        }],
      }),
    } as any);

    const collector = new JiraCollector(config);
    const diff = await collector.collect('PROJ', 'HEAD');

    expect(diff.commits).toHaveLength(1);
    expect(diff.commits[0].hash).toBe('PROJ-1');
    expect(diff.commits[0].message).toContain('Add login page');
    expect(diff.commits[0].author).toBe('Alice');
    expect(diff.from).toContain('jira:');
  });

  it('handles JQL queries in from parameter', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total: 0, issues: [] }),
    } as any);

    const collector = new JiraCollector(config);
    const diff = await collector.collect('project = PROJ AND sprint = "Sprint 1"', 'HEAD');

    expect(diff.commits).toHaveLength(0);
    const [url] = mockedFetch.mock.calls[0];
    expect(url).toContain('jql=');
  });

  it('throws without credentials', async () => {
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;

    const collector = new JiraCollector({ domain: 'test.atlassian.net' });
    await expect(collector.collect('PROJ', 'HEAD')).rejects.toThrow('Jira credentials');
  });

  it('throws on API error', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as any);

    const collector = new JiraCollector(config);
    await expect(collector.collect('PROJ', 'HEAD')).rejects.toThrow('Jira API error');
  });
});
