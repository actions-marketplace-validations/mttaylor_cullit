import type { Enricher, GitDiff, EnrichedTicket } from '../types';
import { fetchWithTimeout } from '../fetch';

/**
 * Enriches git diff with Linear issue details.
 * Extracts issue identifiers from commit messages and branch names.
 */
export class LinearEnricher implements Enricher {
  private apiKey: string;

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

    // Batch fetch all issues in a single GraphQL query
    try {
      return await this.fetchIssuesBatch(keys);
    } catch (err) {
      console.warn(`⚠ Linear batch fetch failed, falling back to individual queries: ${(err as Error).message}`);
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
        console.warn(`⚠ Could not fetch Linear issue ${key}: ${(err as Error).message}`);
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
        'Authorization': this.apiKey,
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

    const data = await response.json() as any;
    const issues = data.data?.issues?.nodes || [];

    const priorityMap: Record<number, string> = {
      0: 'none', 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low'
    };

    return issues.map((issue: any) => ({
      key: issue.identifier,
      title: issue.title,
      description: issue.description?.substring(0, 500),
      labels: issue.labels?.nodes?.map((l: any) => l.name) || [],
      priority: priorityMap[issue.priority] || undefined,
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
        'Authorization': this.apiKey,
      },
      body: JSON.stringify({ query, variables: { id: identifier } }),
    });

    if (!response.ok) {
      throw new Error(`Linear API error (${response.status})`);
    }

    const data = await response.json() as any;
    const issue = data.data?.issueSearch?.nodes?.[0];

    if (!issue) return null;

    const priorityMap: Record<number, string> = {
      0: 'none', 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low'
    };

    return {
      key: issue.identifier,
      title: issue.title,
      description: issue.description?.substring(0, 500),
      labels: issue.labels?.nodes?.map((l: any) => l.name) || [],
      priority: priorityMap[issue.priority] || undefined,
      status: issue.state?.name,
      source: 'linear',
    };
  }
}
