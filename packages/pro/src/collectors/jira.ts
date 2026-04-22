import type { Collector, GitDiff, GitCommit, JiraConfig } from '@cullit/core';
import { fetchWithTimeout } from '@cullit/core';

/**
 * Collects release data directly from Jira (no git required).
 * Queries completed issues by JQL (project, sprint, date range, etc.)
 */
export class JiraCollector implements Collector {
  private config: JiraConfig;

  constructor(config: JiraConfig) {
    this.config = config;
  }

  async collect(from: string, to: string): Promise<GitDiff> {
    const jql = this.buildJQL(from, to);
    const issues = await this.fetchIssues(jql);

    const commits: GitCommit[] = issues.map(issue => ({
      hash: issue.key,
      shortHash: issue.key,
      author: issue.assignee || 'unassigned',
      date: issue.resolved || issue.updated || new Date().toISOString(),
      message: `${issue.type ? `[${issue.type}] ` : ''}${issue.summary}`,
      body: issue.description?.substring(0, 500),
      issueKeys: [issue.key],
    }));

    return {
      from: `jira:${from}`,
      to: to === 'HEAD' ? `jira:${new Date().toISOString().split('T')[0]}` : `jira:${to}`,
      commits,
      filesChanged: 0,
    };
  }

  private buildJQL(from: string, to: string): string {
    // If user passes a raw JQL expression, sanitize it to prevent injection
    if (from.includes('=') || from.includes('AND') || from.includes('OR')) {
      const sanitized = this.sanitizeJQL(from);
      const statusFilter = ' AND status in (Done, Closed, Resolved)';
      return sanitized.toLowerCase().includes('status') ? sanitized : sanitized + statusFilter;
    }

    if (!/^[A-Z][A-Z0-9_]{0,30}$/.test(from)) {
      throw new Error(`Invalid Jira project key: "${from}". Must be uppercase letters, digits, or underscores (e.g., PROJ, MY_PROJ).`);
    }

    const safeVersion = to.replace(/["'\\;]/g, '');

    if (to === 'HEAD') {
      return `project = "${from}" AND status in (Done, Closed, Resolved) AND resolved >= -30d ORDER BY resolved DESC`;
    }

    return `project = "${from}" AND fixVersion = "${safeVersion}" AND status in (Done, Closed, Resolved) ORDER BY resolved DESC`;
  }

  /** Sanitize a user-provided JQL string to prevent injection attacks. */
  private sanitizeJQL(jql: string): string {
    // Reject dangerous JQL patterns: nested functions, semicolons, comment syntax
    if (/[;{}]|\/\*|\*\/|--/.test(jql)) {
      throw new Error('Invalid JQL: contains disallowed characters.');
    }
    // Limit JQL length to prevent abuse
    if (jql.length > 1000) {
      throw new Error('JQL query too long (max 1000 characters).');
    }
    // Only allow known safe JQL characters (letters, digits, spaces, basic operators, quotes, parens)
    const allowedPattern = /^[\w\s=<>!~(),"'.\-@]+$/;
    if (!allowedPattern.test(jql)) {
      throw new Error('Invalid JQL: contains unsupported characters.');
    }
    // Block subquery/function-call patterns like "issueFunction in ..."
    if (/\b(issueFunction|portfolioChildIssuesOf|linkedIssuesOf|issuesLinkedTo)\b/i.test(jql)) {
      throw new Error('Invalid JQL: advanced functions are not supported.');
    }
    return jql;
  }

  private async fetchIssues(jql: string): Promise<JiraIssue[]> {
    const { domain, email, apiToken } = this.config;

    if (!/^[a-zA-Z0-9.-]+\.atlassian\.net$/.test(domain)) {
      throw new Error(`Invalid Jira domain: "${domain}". Expected format: yourcompany.atlassian.net`);
    }

    const resolvedEmail = email || process.env.JIRA_EMAIL;
    const resolvedToken = apiToken || process.env.JIRA_API_TOKEN;

    if (!resolvedEmail || !resolvedToken) {
      throw new Error('Jira credentials not configured. Set JIRA_EMAIL and JIRA_API_TOKEN.');
    }

    const auth = Buffer.from(`${resolvedEmail}:${resolvedToken}`).toString('base64');
    const issues: JiraIssue[] = [];
    let startAt = 0;
    const maxResults = 50;
    let hasMore = true;

    while (hasMore) {
      const url = new URL(`https://${domain}/rest/api/3/search`);
      url.searchParams.set('jql', jql);
      url.searchParams.set('startAt', String(startAt));
      url.searchParams.set('maxResults', String(maxResults));
      url.searchParams.set('fields', 'summary,issuetype,assignee,status,resolution,resolutiondate,updated,labels,priority,description,fixVersions');

      const response = await fetchWithTimeout(url.toString(), {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jira API error (${response.status}): ${error}`);
      }

      const data = await response.json() as JiraSearchResponse;
      const batch = (data.issues || []).map(issue => ({
        key: issue.key,
        summary: issue.fields.summary || '',
        type: issue.fields.issuetype?.name?.toLowerCase(),
        assignee: issue.fields.assignee?.displayName,
        status: issue.fields.status?.name,
        resolved: issue.fields.resolutiondate,
        updated: issue.fields.updated,
        description: issue.fields.description?.content?.[0]?.content?.[0]?.text,
        labels: issue.fields.labels || [],
        priority: issue.fields.priority?.name,
      }));

      issues.push(...batch);

      if (issues.length >= data.total || batch.length < maxResults) {
        hasMore = false;
      } else {
        startAt += maxResults;
      }
    }

    return issues;
  }
}

interface JiraIssue {
  key: string;
  summary: string;
  type?: string;
  assignee?: string;
  status?: string;
  resolved?: string;
  updated?: string;
  description?: string;
  labels?: string[];
  priority?: string;
}

interface JiraSearchResponse {
  total: number;
  issues: Array<{
    key: string;
    fields: {
      summary?: string;
      issuetype?: { name?: string };
      assignee?: { displayName?: string };
      status?: { name?: string };
      resolutiondate?: string;
      updated?: string;
      description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
      labels?: string[];
      priority?: { name?: string };
    };
  }>;
}
