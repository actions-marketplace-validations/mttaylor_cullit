import type { Enricher, GitDiff, EnrichedTicket, JiraConfig } from '@cullit/core';
import { fetchWithTimeout, createLogger } from '@cullit/core';

const log = createLogger();

interface JiraIssueResponse {
  fields?: {
    summary?: string;
    issuetype?: { name?: string };
    labels?: string[];
    priority?: { name?: string };
    status?: { name?: string };
  };
}

/**
 * Enriches git diff with Jira ticket details.
 * Extracts PROJ-123 style keys from commit messages and fetches from Jira REST API.
 */
export class JiraEnricher implements Enricher {
  private config: JiraConfig;

  constructor(config: JiraConfig) {
    this.config = config;
  }

  async enrich(diff: GitDiff): Promise<EnrichedTicket[]> {
    const keys = this.extractUniqueKeys(diff);
    if (keys.length === 0) return [];

    const tickets: EnrichedTicket[] = [];

    for (const key of keys) {
      try {
        const ticket = await this.fetchTicket(key);
        if (ticket) tickets.push(ticket);
      } catch (err) {
        log.warn(`⚠ Could not fetch Jira ticket ${key}: ${(err as Error).message}`);
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

  private async fetchTicket(key: string): Promise<EnrichedTicket | null> {
    const { domain, email, apiToken } = this.config;
    const resolvedEmail = email || process.env.JIRA_EMAIL;
    const resolvedToken = apiToken || process.env.JIRA_API_TOKEN;

    if (!resolvedEmail || !resolvedToken) {
      throw new Error('Jira credentials not configured. Set JIRA_EMAIL and JIRA_API_TOKEN.');
    }

    const auth = Buffer.from(`${resolvedEmail}:${resolvedToken}`).toString('base64');

    const response = await fetchWithTimeout(
      `https://${domain}/rest/api/3/issue/${key}?fields=summary,issuetype,labels,priority,status,description`,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
        },
      }
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Jira API error (${response.status})`);
    }

    const data = await response.json() as JiraIssueResponse;
    const fields = data.fields || {};

    return {
      key,
      title: fields.summary || key,
      type: fields.issuetype?.name?.toLowerCase(),
      labels: fields.labels || [],
      priority: fields.priority?.name,
      status: fields.status?.name,
      source: 'jira',
    };
  }
}
