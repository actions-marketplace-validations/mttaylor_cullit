import type { Collector, GitDiff, GitCommit } from '@cullit/core';
import { fetchWithTimeout } from '@cullit/core';

/**
 * Collects commits and merge requests from the GitLab API.
 * Works with both gitlab.com and self-hosted GitLab instances.
 *
 * Requires GITLAB_TOKEN env var.
 * Config: gitlab.domain (default: gitlab.com), gitlab.projectId
 */
export class GitLabCollector implements Collector {
  private token: string;
  private domain: string;
  private projectId: string;

  constructor(config: { domain?: string; projectId: string }) {
    this.token = process.env.GITLAB_TOKEN || '';
    if (!this.token) {
      throw new Error('GITLAB_TOKEN is required for GitLab source. Set it in your environment.');
    }

    this.domain = config.domain || 'gitlab.com';
    this.projectId = config.projectId;

    if (!this.projectId) {
      throw new Error('GitLab projectId is required (numeric ID or URL-encoded path like "group%2Fproject")');
    }
  }

  async collect(from: string, to: string): Promise<GitDiff> {
    const resolvedTo = to === 'HEAD' ? 'main' : to;

    // Fetch commits between refs
    const commits = await this.fetchCommits(from, resolvedTo);

    // Fetch merge requests for richer context
    const mergeRequests = await this.fetchMergedMRs(from, resolvedTo);

    // Merge MR data into commits
    const mrByCommit = new Map<string, MRInfo>();
    for (const mr of mergeRequests) {
      if (mr.mergeCommitSha) {
        mrByCommit.set(mr.mergeCommitSha, mr);
      }
    }

    const gitCommits: GitCommit[] = commits.map(c => {
      const mr = mrByCommit.get(c.id);
      return {
        hash: c.id,
        shortHash: c.short_id,
        author: c.author_name,
        date: c.authored_date,
        message: c.title,
        body: c.message !== c.title ? c.message : undefined,
        prNumber: mr?.iid,
        issueKeys: this.extractIssueKeys(c.message),
      };
    });

    return {
      from,
      to: resolvedTo,
      commits: gitCommits,
      filesChanged: undefined,
    };
  }

  private async fetchCommits(from: string, to: string): Promise<GitLabCommit[]> {
    const url = new URL(`https://${this.domain}/api/v4/projects/${encodeURIComponent(this.projectId)}/repository/compare`);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('per_page', '100');

    const res = await fetchWithTimeout(url.toString(), { headers: this.headers() });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`GitLab API error (${res.status}): ${error}`);
    }

    const data = await res.json() as { commits: GitLabCommit[] };
    return data.commits || [];
  }

  private async fetchMergedMRs(from: string, to: string): Promise<MRInfo[]> {
    try {
      const url = new URL(`https://${this.domain}/api/v4/projects/${encodeURIComponent(this.projectId)}/merge_requests`);
      url.searchParams.set('state', 'merged');
      url.searchParams.set('target_branch', to === 'main' || to === 'master' ? to : 'main');
      url.searchParams.set('per_page', '100');
      url.searchParams.set('order_by', 'updated_at');
      url.searchParams.set('sort', 'desc');

      const res = await fetchWithTimeout(url.toString(), { headers: this.headers() });
      if (!res.ok) return [];

      const data = await res.json() as GitLabMergeRequestResponse[];
      return data.map(mr => ({
        iid: mr.iid,
        title: mr.title,
        mergeCommitSha: mr.merge_commit_sha,
      }));
    } catch {
      return []; // MR enrichment is best-effort
    }
  }

  private extractIssueKeys(message: string): string[] {
    const keys: string[] = [];
    // Jira-style: PROJ-123
    const jiraMatches = message.match(/[A-Z][A-Z0-9]+-\d+/g);
    if (jiraMatches) keys.push(...jiraMatches);
    // GitLab-style: #123
    const glMatches = message.match(/#(\d+)/g);
    if (glMatches) keys.push(...glMatches);
    return keys;
  }

  private headers(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.token,
      'Accept': 'application/json',
    };
  }
}

interface GitLabCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  authored_date: string;
}

interface MRInfo {
  iid: number;
  title: string;
  mergeCommitSha?: string;
}

interface GitLabMergeRequestResponse {
  iid: number;
  title: string;
  merge_commit_sha?: string;
}
