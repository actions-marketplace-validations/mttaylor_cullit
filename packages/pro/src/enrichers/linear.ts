import type { Enricher, GitDiff, EnrichedTicket } from '@cullit/core';
import { fetchWithTimeout, createLogger } from '@cullit/core';

const log = createLogger();

interface LinearIssueNode {
  identifier: string;
  title: string;
  description?: string;
  priority?: number;
  state?: { name?: string };
  labels?: { nodes?: Array<{ name: string }> };
}

interface LinearBatchResponse {
  data?: { issues?: { nodes?: LinearIssueNode[] } };
}

interface LinearSingleResponse {
  data?: { issueSearch?: { nodes?: LinearIssueNode[] } };
}

/**
 * Enriches git diff with Linear issue details.
 * Extracts issue identifiers from commit messages and branch names.
 */
export class LinearEnricher implements Enricher {
  private apiKey: string;

  private static readonly PRIORITY_MAP: Record<number, string> = {
    0: 'none', 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low'
  };

  constructor(apiKey?: string) {
    const resolved = apiKey || process.env.LINEAR_API_KEY;
    if (!resolved) {
      throw new Error('Linear API key not configured. Set LINEAR_API_KEY.');
    }
    this.apiKey = resolved;
  }

  async enrich(diff: GitDiff): Promise<EnrichedTicket[]> {
    const keys = this.extractUniqueKeys(diff);
    if (keys.length === 0) return [];

    try {
      return await this.fetchIssuesBatch(keys);
    } catch (err) {
      log.warn(`⚠ Linear batch fetch failed, falling back to individual queries: ${(err as Error).message}`);
      return this.fetchIssuesIndividually(keys);
    }
  }

  private async fetchIssuesIndividually(keys: string[]): Promise<EnrichedTicket[]> {
    const tickets: EnrichedTicket[] = [];
    for (const key of keys) {
      try {
        const ticket = await this.fetchIssue(key);
        if (ticket) tickets.push(ticket);
      } catch (err) {
        log.warn(`⚠ Could not fetch Linear issue ${key}: ${(err as Error).message}`);
      }
    }
    return tickets;
  }

  private extractUniqueKeys(diff: GitDiff): string[] {
    const allKeys: string[] = [];
    for (const commit of diff.commits) {
      if (commit.issueKeys) allKeys.push(...commit.issueKeys);
    }
    return [...new Set(allKeys)];
  }

  private async fetchIssuesBatch(identifiers: string[]): Promise<EnrichedTicket[]> {
    const query = `
      query BatchIssues($filter: IssueFilter!) {
        issues(filter: $filter, first: 100) {
          nodes {
            identifier
            title
            description
            priority
            state { name }
            labels { nodes { name } }
          }
        }
      }
    `;

    const response = await fetchWithTimeout('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          filter: { identifier: { in: identifiers } },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Linear API error (${response.status})`);
    }

    const data = await response.json() as LinearBatchResponse;
    const issues = data.data?.issues?.nodes || [];

    return issues.map(issue => ({
      key: issue.identifier,
      title: issue.title,
      description: issue.description?.substring(0, 500),
      labels: issue.labels?.nodes?.map(l => l.name) || [],
      priority: issue.priority !== undefined ? LinearEnricher.PRIORITY_MAP[issue.priority] : undefined,
      status: issue.state?.name,
      source: 'linear' as const,
    }));
  }

  private async fetchIssue(identifier: string): Promise<EnrichedTicket | null> {
    const query = `
      query IssueByIdentifier($id: String!) {
        issueSearch(filter: { identifier: { eq: $id } }, first: 1) {
          nodes {
            identifier
            title
            description
            priority
            state { name }
            labels { nodes { name } }
          }
        }
      }
    `;

    const response = await fetchWithTimeout('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, variables: { id: identifier } }),
    });

    if (!response.ok) {
      throw new Error(`Linear API error (${response.status})`);
    }

    const data = await response.json() as LinearSingleResponse;
    const issue = data.data?.issueSearch?.nodes?.[0];

    if (!issue) return null;

    return {
      key: issue.identifier,
      title: issue.title,
      description: issue.description?.substring(0, 500),
      labels: issue.labels?.nodes?.map(l => l.name) || [],
      priority: issue.priority !== undefined ? LinearEnricher.PRIORITY_MAP[issue.priority] : undefined,
      status: issue.state?.name,
      source: 'linear',
    };
  }
}
