import { execFileSync } from 'child_process';
import type { Collector, GitCommit, GitDiff } from '../types';
import { CullitError, CoreErrorCode } from '../errors';

/**
 * Validates a git ref to prevent command injection.
 * Allows: tags (v1.0.0), branches, SHAs, HEAD, HEAD~N
 */
function validateRef(ref: string): void {
  if (!ref || ref.length > 256) {
    throw new CullitError(CoreErrorCode.GIT_REF_INVALID, `Invalid git ref: too ${ref ? 'long' : 'short'}`);
  }
  // Allow alphanumeric, dots, dashes, underscores, slashes, tildes (for HEAD~N ancestor syntax)
  if (!/^[a-zA-Z0-9._\-/~]+$/.test(ref)) {
    throw new CullitError(CoreErrorCode.GIT_REF_INVALID, `Invalid git ref "${ref}" — only alphanumeric, dots, dashes, underscores, slashes, and tildes are allowed`);
  }
}

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
    validateRef(from);
    validateRef(to);
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
    // Format: hash<RS>shortHash<RS>author<RS>date<RS>subject<RS>body
    // Uses ASCII Record Separator (%x1e) to avoid conflicts with pipe in commit messages
    const format = '%H%x1e%h%x1e%an%x1e%aI%x1e%s%x1e%b';
    const separator = '---CULLIT_COMMIT---';

    try {
      return execFileSync(
        'git',
        ['log', `${from}..${to}`, `--format=${format}${separator}`, '--no-merges'],
        { cwd: this.cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (error) {
      const errWithStderr = typeof error === 'object' && error !== null && 'stderr' in error
        ? (error as { stderr?: { toString?: () => string } })
        : undefined;
      const stderr = errWithStderr?.stderr?.toString?.() || '';
      const hint = stderr.includes('unknown revision')
        ? 'Check that both refs exist (run "cullit tags" to see tags).'
        : stderr.includes('not a git repository')
        ? 'Run this command inside a git repository.'
        : `Make sure both refs exist and you're in a git repository.`;
      throw new CullitError(
        CoreErrorCode.GIT_LOG_FAILED, `Failed to read git log between ${from} and ${to}. ${hint}`
      );
    }
  }

  private parseLog(log: string): GitCommit[] {
    if (!log.trim()) return [];

    const separator = '---CULLIT_COMMIT---';
    const entries = log.split(separator).filter(e => e.trim());

    return entries.map(entry => {
      const parts = entry.trim().split('\x1e');
      const [hash, shortHash, author, date, message, ...bodyParts] = parts;
      const body = bodyParts.join('\x1e').trim() || undefined;
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
      const output = execFileSync(
        'git',
        ['diff', '--shortstat', `${from}..${to}`],
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
    const output = execFileSync(
      'git',
      ['tag', '--sort=-v:refname'],
      { cwd, encoding: 'utf-8' }
    );
    return output.trim().split('\n').filter(Boolean).slice(0, count);
  } catch {
    return [];
  }
}

/**
 * Gets the latest tag on current branch.
 */
export function getLatestTag(cwd: string = process.cwd()): string | null {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Synchronously gets commits between two refs.
 * Shared utility used by both GitCollector and advisor.
 */
export function getCommitsSince(from: string, to: string, cwd: string = process.cwd()): GitCommit[] {
  validateRef(from);
  validateRef(to);

  const format = '%H%x1e%h%x1e%an%x1e%aI%x1e%s';
  const separator = '---CULLIT_COMMIT---';

  const log = execFileSync(
    'git',
    ['log', `${from}..${to}`, `--format=${format}${separator}`, '--no-merges'],
    { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  if (!log.trim()) return [];

  return log.split(separator).filter(e => e.trim()).map(entry => {
    const [hash, shortHash, author, date, ...msgParts] = entry.trim().split('\x1e');
    return {
      hash: hash.trim(),
      shortHash: shortHash.trim(),
      author: author.trim(),
      date: date.trim(),
      message: msgParts.join('\x1e').trim(),
    };
  });
}
