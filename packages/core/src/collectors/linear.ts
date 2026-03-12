import type { Collector, GitDiff, GitCommit } from '../types';

/**
 * Collects release data directly from Linear (no git required).
 * Queries completed issues by project, cycle, or team.
 *
 * Usage:
 *   --from "team:ENG"              (completed issues from team ENG, last 30 days)
 *   --from "project:Project Name"  (completed issues from a project)
 *   --from "cycle:current"         (current cycle's completed issues)
 *   --from "label:release-v2"      (issues with a specific label)
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
    const value = valueParts.join(':') || type; // handle "team:ENG" or bare "ENG"

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
        // Assume it's a team key
        return { type: 'team', value: from };
    }
  }

  private async fetchIssues(filter: LinearFilter): Promise<LinearIssue[]> {
    const filterClause = this.buildFilterClause(filter);

    const query = `
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

    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Linear API error (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    const nodes = data.data?.issues?.nodes || [];

    const priorityMap: Record<number, string> = {
      0: 'none', 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low'
    };

    return nodes.map((issue: any) => ({
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description?.substring(0, 500),
      type: issue.labels?.nodes?.[0]?.name?.toLowerCase(),
      assignee: issue.assignee?.displayName,
      status: issue.state?.name,
      completedAt: issue.completedAt,
      updatedAt: issue.updatedAt,
      labels: issue.labels?.nodes?.map((l: any) => l.name) || [],
      priority: priorityMap[issue.priority],
    }));
  }

  private buildFilterClause(filter: LinearFilter): string {
    switch (filter.type) {
      case 'team':
        return `team: { key: { eq: "${filter.value}" } }`;
      case 'project':
        return `project: { name: { containsIgnoreCase: "${filter.value}" } }`;
      case 'cycle':
        if (filter.value === 'current') {
          return `cycle: { isActive: { eq: true } }`;
        }
        return `cycle: { name: { containsIgnoreCase: "${filter.value}" } }`;
      case 'label':
        return `labels: { name: { eq: "${filter.value}" } }`;
      default:
        return '';
    }
  }
}

interface LinearFilter {
  type: 'team' | 'project' | 'cycle' | 'label';
  value: string;
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
