import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Collector, GitDiff, GitCommit } from '../types';
import type { RepoSource } from '@cullit/config';
import { GitCollector } from './git';
import { CullitError, CoreErrorCode } from '../errors';

/**
 * Collects commits from multiple repositories and merges them into a single GitDiff.
 * Supports both local paths and remote URLs (shallow-cloned to temp dirs).
 *
 * Commits are tagged with `[repo-name]` prefix in the message for traceability.
 * Results are sorted by date (newest first) across all repos.
 */
export class MultiRepoCollector implements Collector {
  private repos: RepoSource[];
  private tempDirs: string[] = [];

  constructor(repos: RepoSource[]) {
    if (!repos.length) throw new CullitError(CoreErrorCode.MULTI_REPO_EMPTY, 'Multi-repo collector requires at least one repo');
    this.repos = repos;
  }

  async collect(from: string, to: string): Promise<GitDiff> {
    const allCommits: GitCommit[] = [];
    let totalFilesChanged = 0;

    try {
      for (const repo of this.repos) {
        const repoPath = await this.resolveRepoPath(repo);
        const repoName = repo.name || this.inferName(repo);
        const repoFrom = repo.from || from;
        const repoTo = repo.to || to;

        const collector = new GitCollector(repoPath);
        const diff = await collector.collect(repoFrom, repoTo);

        // Tag commits with repo name for traceability
        const taggedCommits = diff.commits.map(c => ({
          ...c,
          message: `[${repoName}] ${c.message}`,
        }));

        allCommits.push(...taggedCommits);
        totalFilesChanged += diff.filesChanged || 0;
      }
    } finally {
      this.cleanup();
    }

    // Sort by date descending (newest first)
    allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      from,
      to,
      commits: allCommits,
      filesChanged: totalFilesChanged,
    };
  }

  private async resolveRepoPath(repo: RepoSource): Promise<string> {
    if (repo.path) return repo.path;

    if (!repo.url) {
      throw new CullitError(CoreErrorCode.MULTI_REPO_MISSING_TARGET, 'Each repo must have either "url" or "path"');
    }

    // Validate URL - only allow git protocols
    if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(repo.url)) {
      throw new CullitError(CoreErrorCode.MULTI_REPO_INVALID_URL, `Invalid repo URL: ${repo.url}`);
    }

    // Block internal/private hostnames to prevent SSRF
    try {
      const parsed = new URL(repo.url);
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
          host === '[::1]' || host.startsWith('[::ffff:') ||
          host.endsWith('.local') || host === '0.0.0.0' ||
          /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host) ||
          /^169\.254\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(host) ||
          host === '[::]' || host.startsWith('0.') || host === '[::]') {
        throw new CullitError(CoreErrorCode.MULTI_REPO_INVALID_URL, `Private/internal URLs are not allowed: ${repo.url}`);
      }
    } catch (e) {
      if (e instanceof CullitError) throw e;
      // git@ URLs won't parse as URL — that's fine, they go to external servers
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'cullit-repo-'));
    this.tempDirs.push(tempDir);

    execFileSync(
      'git', ['clone', '--depth=500', '--single-branch', repo.url, tempDir],
      { encoding: 'utf-8', timeout: 60_000, stdio: 'pipe' }
    );

    return tempDir;
  }

  private inferName(repo: RepoSource): string {
    const source = repo.url || repo.path || 'unknown';
    // Extract repo name from URL or path
    const basename = source.replace(/\.git$/, '').split(/[/\\]/).pop();
    return basename || 'unknown';
  }

  private cleanup(): void {
    for (const dir of this.tempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    this.tempDirs = [];
  }
}
