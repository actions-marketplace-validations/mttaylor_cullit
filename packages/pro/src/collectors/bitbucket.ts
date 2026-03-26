import type { Collector, GitDiff, GitCommit } from '@cullit/core';
import { fetchWithTimeout, createLogger } from '@cullit/core';

const log = createLogger();

/**
 * Collects commits from the Bitbucket Cloud API.
 * Supports comparing between tags, branches, or commit SHAs.
 *
 * Requires BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD env vars.
 * Config: bitbucket.workspace, bitbucket.repoSlug
 */
export class BitbucketCollector implements Collector {
  private workspace: string;
  private repoSlug: string;
  private auth: string;

  constructor(config: { workspace: string; repoSlug: string }) {
    const username = process.env.BITBUCKET_USERNAME || '';
    const appPassword = process.env.BITBUCKET_APP_PASSWORD || '';

    if (!username || !appPassword) {
      throw new Error('Bitbucket credentials required. Set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD.');
    }
    if (!config.workspace || !config.repoSlug) {
      throw new Error('Bitbucket workspace and repoSlug are required in config');
    }

    this.workspace = config.workspace;
    this.repoSlug = config.repoSlug;
    this.auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
  }

  async collect(from: string, to: string): Promise<GitDiff> {
    const resolvedTo = to === 'HEAD' ? 'main' : to;

    // Use the diffstat endpoint to compare refs
    const commits = await this.fetchCommitsBetween(from, resolvedTo);

    const gitCommits: GitCommit[] = commits.map(c => ({
      hash: c.hash,
      shortHash: c.hash.substring(0, 7),
      author: c.author?.raw?.split('<')[0]?.trim() || c.author?.user?.display_name || 'unknown',
      date: c.date,
      message: c.message.split('\n')[0],
      body: c.message.includes('\n') ? c.message : undefined,
      prNumber: this.extractPRNumber(c.message),
      issueKeys: this.extractIssueKeys(c.message),
    }));

    return {
      from,
      to: resolvedTo,
      commits: gitCommits,
      filesChanged: undefined,
    };
  }

  private async fetchCommitsBetween(from: string, to: string): Promise<BBCommit[]> {
    const commits: BBCommit[] = [];
    let url: string | null = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(this.workspace)}/${encodeURIComponent(this.repoSlug)}/commits?include=${encodeURIComponent(to)}&exclude=${encodeURIComponent(from)}`;

    while (url) {
      const res = await fetchWithTimeout(url, { headers: this.headers() });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Bitbucket API error (${res.status}): ${error}`);
      }

      const data = await res.json() as { values: BBCommit[]; next?: string };
      commits.push(...(data.values || []));

      // Safety cap: don't fetch more than 500 commits
      if (commits.length >= 500) {
        log.warn(`⚠ Bitbucket: ${commits.length} commits fetched — capped at 500. Release notes may be incomplete. Use a narrower range.`);
        break;
      }
      url = data.next || null;
    }

    return commits;
  }

  private extractPRNumber(message: string): number | undefined {
    // Bitbucket MR pattern: "Merged in feature (pull request #123)"
    const match = message.match(/pull request #(\d+)/i);
    return match ? parseInt(match[1], 10) : undefined;
  }

  private extractIssueKeys(message: string): string[] {
    const keys: string[] = [];
    const jiraMatches = message.match(/[A-Z][A-Z0-9]+-\d+/g);
    if (jiraMatches) keys.push(...jiraMatches);
    return keys;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Basic ${this.auth}`,
      'Accept': 'application/json',
    };
  }
}

interface BBCommit {
  hash: string;
  date: string;
  message: string;
  author: {
    raw?: string;
    user?: { display_name: string };
  };
}
