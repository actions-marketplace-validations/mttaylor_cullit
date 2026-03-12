import { execSync } from 'child_process';
import type { Collector, GitCommit, GitDiff } from '../types';

/**
 * Collects git log data between two refs (tags, branches, or commit SHAs).
 * Extracts commits, PR numbers, and issue keys from commit messages.
 */
export class GitCollector implements Collector {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  async collect(from: string, to: string): Promise<GitDiff> {
    const log = this.getLog(from, to);
    const commits = this.parseLog(log);

    return {
      from,
      to,
      commits,
      filesChanged: this.getFilesChanged(from, to),
    };
  }

  private getLog(from: string, to: string): string {
    // Format: hash|shortHash|author|date|subject|body
    const format = '%H|%h|%an|%aI|%s|%b';
    const separator = '---CULLIT_COMMIT---';

    try {
      return execSync(
        `git log ${from}..${to} --format="${format}${separator}" --no-merges`,
        { cwd: this.cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (error) {
      throw new Error(
        `Failed to read git log between ${from} and ${to}. ` +
        `Make sure both refs exist and you're in a git repository.`
      );
    }
  }

  private parseLog(log: string): GitCommit[] {
    if (!log.trim()) return [];

    const separator = '---CULLIT_COMMIT---';
    const entries = log.split(separator).filter(e => e.trim());

    return entries.map(entry => {
      const parts = entry.trim().split('|');
      const [hash, shortHash, author, date, message, ...bodyParts] = parts;
      const body = bodyParts.join('|').trim() || undefined;
      const fullMessage = body ? `${message}\n${body}` : message;

      return {
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        author: author.trim(),
        date: date.trim(),
        message: message.trim(),
        body,
        prNumber: this.extractPRNumber(fullMessage),
        issueKeys: this.extractIssueKeys(fullMessage),
      };
    });
  }

  /**
   * Extracts PR number from commit messages.
   * Matches patterns like: (#123), Merge pull request #123, PR #123
   */
  private extractPRNumber(message: string): number | undefined {
    const patterns = [
      /\(#(\d+)\)/,                          // (#123)
      /Merge pull request #(\d+)/i,          // Merge pull request #123
      /PR\s*#(\d+)/i,                        // PR #123
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) return parseInt(match[1], 10);
    }
    return undefined;
  }

  /**
   * Extracts issue keys from commit messages.
   * Matches patterns like: PROJ-123, FIX-456, LIN-789
   */
  private extractIssueKeys(message: string): string[] {
    const pattern = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
    const matches = message.match(pattern);
    return matches ? [...new Set(matches)] : [];
  }

  private getFilesChanged(from: string, to: string): number {
    try {
      const output = execSync(
        `git diff --stat ${from}..${to} | tail -1`,
        { cwd: this.cwd, encoding: 'utf-8' }
      );
      const match = output.match(/(\d+) files? changed/);
      return match ? parseInt(match[1], 10) : 0;
    } catch {
      return 0;
    }
  }
}

/**
 * Gets list of available tags, most recent first.
 */
export function getRecentTags(cwd: string = process.cwd(), count: number = 10): string[] {
  try {
    const output = execSync(
      `git tag --sort=-v:refname | head -${count}`,
      { cwd, encoding: 'utf-8' }
    );
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Gets the latest tag on current branch.
 */
export function getLatestTag(cwd: string = process.cwd()): string | null {
  try {
    return execSync('git describe --tags --abbrev=0', { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}
