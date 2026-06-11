import type { Collector, GitCommit, GitDiff } from '../types';
import { fetchWithTimeout } from '../fetch';
import { CullitError, CoreErrorCode } from '../errors';

type GitHubCompareCommit = {
  sha?: string;
  commit?: {
    author?: { name?: string; date?: string };
    message?: string;
  };
  author?: { login?: string };
};

type GitHubCompareResponse = {
  commits?: GitHubCompareCommit[];
  files?: unknown[];
  message?: string;
};

export class GitHubCollector implements Collector {
  private owner: string;
  private repo: string;
  private token?: string;

  constructor(owner: string, repo: string, token?: string) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
  }

  async collect(from: string, to: string): Promise<GitDiff> {
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cullit-core',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetchWithTimeout(endpoint, { method: 'GET', headers }, 20_000);
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json() as GitHubCompareResponse;
        detail = payload.message ? ` ${payload.message}` : '';
      } catch {
        // Ignore JSON parse failures and return status-based message.
      }
      const hint = response.status === 404
        ? `Check that refs "${from}" and "${to}" exist for ${this.owner}/${this.repo}.`
        : `GitHub compare API returned ${response.status}.`;
      throw new CullitError(CoreErrorCode.GIT_LOG_FAILED, `Failed to read git log between ${from} and ${to}. ${hint}${detail}`.trim());
    }

    const payload = await response.json() as GitHubCompareResponse;
    const commits = (payload.commits || []).map(c => toCommit(c));

    return {
      from,
      to,
      commits,
      filesChanged: Array.isArray(payload.files) ? payload.files.length : 0,
    };
  }
}

function toCommit(input: GitHubCompareCommit): GitCommit {
  const sha = input.sha || '';
  const message = input.commit?.message || '';
  const [subject, ...bodyLines] = message.split('\n');
  const body = bodyLines.join('\n').trim() || undefined;
  const fullMessage = body ? `${subject}\n${body}` : subject;

  return {
    hash: sha,
    shortHash: sha.slice(0, 7),
    author: input.commit?.author?.name || input.author?.login || 'unknown',
    date: input.commit?.author?.date || new Date(0).toISOString(),
    message: subject || '(no subject)',
    body,
    prNumber: extractPRNumber(fullMessage),
    issueKeys: extractIssueKeys(fullMessage),
  };
}

function extractPRNumber(message: string): number | undefined {
  const patterns = [/\(#(\d+)\)/, /Merge pull request #(\d+)/i, /PR\s*#(\d+)/i];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return parseInt(match[1], 10);
  }
  return undefined;
}

function extractIssueKeys(message: string): string[] {
  const matches = message.match(/\b([A-Z][A-Z0-9]+-\d+)\b/g);
  return matches ? [...new Set(matches)] : [];
}
