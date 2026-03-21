import type { Collector, GitDiff, GitCommit } from '@cullit/core';
import { fetchWithTimeout } from '@cullit/core';

/**
 * Collects release data directly from Linear (no git required).
 * Queries completed issues by project, cycle, or team.
 */
export class LinearCollector implements Collector {
  private apiKey: string;

  constructor(apiKey?: string) {
    const resolved = apiKey || process.env.LINEAR_API_KEY;
    if (!resolved) {
      throw new Error('Linear API key not configured. Set LINEAR_API_KEY.');
    }
    this.apiKey = resolved;
  }

  async collect(from: string, to: string): Promise<GitDiff> {
    const filter = this.parseFilter(from);
    const issues = await this.fetchIssues(filter);

    const commits: GitCommit[] = issues.map(issue => ({
      hash: issue.identifier,
      shortHash: issue.identifier,
      author: issue.assignee || 'unassigned',
      date: issue.completedAt || issue.updatedAt || new Date().toISOString(),
      message: `${issue.type ? `[${issue.type}] ` : ''}${issue.title}`,
      body: issue.description?.substring(0, 500),
      issueKeys: [issue.identifier],
    }));

    return {
      from: `linear:${from}`,
      to: to === 'HEAD' ? `linear:${new Date().toISOString().split('T')[0]}` : `linear:${to}`,
      commits,
      filesChanged: 0,
    };
  }

  private parseFilter(from: string): LinearFilter {
    const [type, ...valueParts] = from.split(':');
    const value = valueParts.join(':') || type;

    switch (type.toLowerCase()) {
      case 'team':
        return { type: 'team', value };
      case 'project':
        return { type: 'project', value };
      case 'cycle':
        return { type: 'cycle', value };
      case 'label':
        return { type: 'label', value };
      default:
        return { type: 'team', value: from };
    }
  }

  private async fetchIssues(filter: LinearFilter): Promise<LinearIssue[]> {
    const filterClause = this.buildFilterClause(filter);
    const needsVariable = filter.type !== 'cycle' || filter.value !== 'current';

    const query = needsVariable
      ? `
      query CompletedIssues($filterValue: String!) {
        issues(
          filter: {
            state: { type: { in: ["completed", "canceled"] } }
            ${filterClause}
          }
          first: 100
          orderBy: completedAt
        ) {
          nodes {
            identifier
            title
            description
            priority
            completedAt
            updatedAt
            assignee { displayName }
            state { name type }
            labels { nodes { name } }
            project { name }
          }
        }
      }
    `
      : `
      query CompletedIssues {
        issues(
          filter: {
            state: { type: { in: ["completed", "canceled"] } }
            ${filterClause}
          }
          first: 100
          orderBy: completedAt
        ) {
          nodes {
            identifier
            title
            description
            priority
            completedAt
            updatedAt
            assignee { displayName }
            state { name type }
            labels { nodes { name } }
            project { name }
          }
        }
      }
    `;

    const variables = needsVariable ? { filterValue: filter.value } : undefined;

    const response = await fetchWithTimeout('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Linear API error (${response.status}): ${error}`);
    }

    const data = await response.json() as LinearIssuesResponse;
    const nodes = data.data?.issues?.nodes || [];

    const priorityMap: Record<number, string> = {
      0: 'none', 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low'
    };

    return nodes.map(issue => ({
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description?.substring(0, 500),
      type: issue.labels?.nodes?.[0]?.name?.toLowerCase(),
      assignee: issue.assignee?.displayName,
      status: issue.state?.name,
      completedAt: issue.completedAt,
      updatedAt: issue.updatedAt,
      labels: issue.labels?.nodes?.map(l => l.name) || [],
      priority: issue.priority !== undefined ? priorityMap[issue.priority] : undefined,
    }));
  }

  private buildFilterClause(filter: LinearFilter): string {
    switch (filter.type) {
      case 'team':
        return `team: { key: { eq: $filterValue } }`;
      case 'project':
        return `project: { name: { containsIgnoreCase: $filterValue } }`;
      case 'cycle':
        if (filter.value === 'current') {
          return `cycle: { isActive: { eq: true } }`;
        }
        return `cycle: { name: { containsIgnoreCase: $filterValue } }`;
      case 'label':
        return `labels: { name: { eq: $filterValue } }`;
      default:
        return '';
    }
  }
}

interface LinearFilter {
  type: 'team' | 'project' | 'cycle' | 'label';
  value: string;
}

interface LinearIssuesResponse {
  data?: {
    issues?: {
      nodes?: Array<{
        identifier: string;
        title: string;
        description?: string;
        priority?: number;
        completedAt?: string;
        updatedAt?: string;
        assignee?: { displayName?: string };
        state?: { name?: string; type?: string };
        labels?: { nodes?: Array<{ name: string }> };
      }>;
    };
  };
}

interface LinearIssue {
  identifier: string;
  title: string;
  description?: string;
  type?: string;
  assignee?: string;
  status?: string;
  completedAt?: string;
  updatedAt?: string;
  labels?: string[];
  priority?: string;
}
