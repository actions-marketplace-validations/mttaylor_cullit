import type { Enricher, GitDiff, EnrichedTicket } from '../types';

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

    const tickets: EnrichedTicket[] = [];

    // Linear GraphQL supports batch queries
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

    const response = await fetch('https://api.linear.app/graphql', {
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
