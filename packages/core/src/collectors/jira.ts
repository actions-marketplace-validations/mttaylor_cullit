import type { Collector, GitDiff, GitCommit, JiraConfig } from '../types';
import { fetchWithTimeout } from '../fetch';

/**
 * Collects release data directly from Jira (no git required).
 * Queries completed issues by JQL (project, sprint, date range, etc.)
 * and converts them into the GitDiff format for the pipeline.
 *
 * Usage:
 *   --from "project = PROJ AND sprint = 'Sprint 42'"
 *   --from "project = PROJ AND resolved >= '2025-03-01'"
 *   --from "project = PROJ AND fixVersion = 'v2.0'"
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
    // If "from" already looks like JQL, use it directly
    if (from.includes('=') || from.includes('AND') || from.includes('OR')) {
      const statusFilter = ' AND status in (Done, Closed, Resolved)';
      return from.includes('status') ? from : from + statusFilter;
    }

    // Validate project key format to prevent JQL injection
    if (!/^[A-Z][A-Z0-9_]{0,30}$/.test(from)) {
      throw new Error(`Invalid Jira project key: "${from}". Must be uppercase letters, digits, or underscores (e.g., PROJ, MY_PROJ).`);
    }

    // Sanitize "to" — strip quotes to prevent injection in fixVersion clause
    const safeVersion = to.replace(/["'\\]/g, '');

    if (to === 'HEAD') {
      return `project = ${from} AND status in (Done, Closed, Resolved) AND resolved >= -30d ORDER BY resolved DESC`;
    }

    return `project = ${from} AND fixVersion = "${safeVersion}" AND status in (Done, Closed, Resolved) ORDER BY resolved DESC`;
  }

  private async fetchIssues(jql: string): Promise<JiraIssue[]> {
    const { domain, email, apiToken } = this.config;

    // Validate domain format
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

    while (true) {
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

      const data = await response.json() as any;
      const batch = (data.issues || []).map((issue: any) => ({
        key: issue.key,
        summary: issue.fields.summary,
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

      if (issues.length >= data.total || batch.length < maxResults) break;
      startAt += maxResults;
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
