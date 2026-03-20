import { execFileSync } from 'child_process';
import type { GitCommit } from './types';
import { getCommitsSince, getLatestTag } from './collectors/git';

export type SemverBump = 'patch' | 'minor' | 'major';

export interface ReleaseAdvisory {
  /** Whether a release is recommended now */
  shouldRelease: boolean;
  /** Suggested semver bump type */
  suggestedBump: SemverBump;
  /** Current (latest) version tag */
  currentVersion: string | null;
  /** What the next version would be */
  nextVersion: string | null;
  /** Number of unreleased commits */
  commitCount: number;
  /** Number of unique contributors */
  contributorCount: number;
  /** Days since last release */
  daysSinceRelease: number | null;
  /** Breakdown of commit types */
  breakdown: {
    features: number;
    fixes: number;
    breaking: number;
    chores: number;
    other: number;
  };
  /** Human-readable reasons for the recommendation */
  reasons: string[];
}

// Conventional commit prefixes → categories
const COMMIT_PATTERNS: Array<{ pattern: RegExp; category: keyof ReleaseAdvisory['breakdown'] }> = [
  { pattern: /^breaking[(!:]|^BREAKING CHANGE/i, category: 'breaking' },
  { pattern: /!:/, category: 'breaking' },
  { pattern: /^feat[(!:]|^feature[(!:]/i, category: 'features' },
  { pattern: /^fix[(!:]/i, category: 'fixes' },
  { pattern: /^chore[(!:]|^docs[(!:]|^ci[(!:]|^test[(!:]|^style[(!:]|^refactor[(!:]/i, category: 'chores' },
];

function categorizeCommit(message: string): keyof ReleaseAdvisory['breakdown'] {
  for (const { pattern, category } of COMMIT_PATTERNS) {
    if (pattern.test(message)) return category;
  }
  return 'other';
}

function bumpVersion(version: string, bump: SemverBump): string {
  const prefix = version.startsWith('v') ? 'v' : '';
  const clean = version.replace(/^v/, '');
  const parts = clean.split('.').map(Number);

  if (parts.length !== 3 || parts.some(isNaN)) return version;

  switch (bump) {
    case 'major': return `${prefix}${parts[0] + 1}.0.0`;
    case 'minor': return `${prefix}${parts[0]}.${parts[1] + 1}.0`;
    case 'patch': return `${prefix}${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
}

function getCommitsSinceTag(tag: string, cwd: string): GitCommit[] {
  try {
    return getCommitsSince(tag, 'HEAD', cwd);
  } catch {
    return [];
  }
}

function getTagDate(tag: string, cwd: string): Date | null {
  try {
    const dateStr = execFileSync(
      'git',
      ['log', '-1', '--format=%aI', tag],
      { cwd, encoding: 'utf-8' }
    ).trim();
    return new Date(dateStr);
  } catch {
    return null;
  }
}

/**
 * Analyzes the repo state and provides a release recommendation.
 * Examines commits since the last tag, categorizes them via conventional
 * commit patterns, and applies industry-standard heuristics.
 */
export function analyzeReleaseReadiness(cwd: string = process.cwd()): ReleaseAdvisory {
  const latestTag = getLatestTag(cwd);
  const reasons: string[] = [];

  if (!latestTag) {
    // No tags at all — first release scenario
    return {
      shouldRelease: true,
      suggestedBump: 'minor',
      currentVersion: null,
      nextVersion: null,
      commitCount: 0,
      contributorCount: 0,
      daysSinceRelease: null,
      breakdown: { features: 0, fixes: 0, breaking: 0, chores: 0, other: 0 },
      reasons: ['No tags found. Consider creating your first release.'],
    };
  }

  const commits = getCommitsSinceTag(latestTag, cwd);
  const commitCount = commits.length;

  // Categorize commits
  const breakdown = { features: 0, fixes: 0, breaking: 0, chores: 0, other: 0 };
  for (const commit of commits) {
    breakdown[categorizeCommit(commit.message)]++;
  }

  // Unique contributors
  const contributors = new Set(commits.map(c => c.author));

  // Days since last release
  const tagDate = getTagDate(latestTag, cwd);
  const daysSinceRelease = tagDate
    ? Math.floor((Date.now() - tagDate.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Determine suggested bump
  let suggestedBump: SemverBump = 'patch';
  if (breakdown.breaking > 0) {
    suggestedBump = 'major';
    reasons.push(`${breakdown.breaking} breaking change(s) detected — major bump recommended`);
  } else if (breakdown.features > 0) {
    suggestedBump = 'minor';
    reasons.push(`${breakdown.features} new feature(s) — minor bump recommended`);
  } else if (breakdown.fixes > 0) {
    reasons.push(`${breakdown.fixes} bug fix(es) — patch bump recommended`);
  }

  // Determine if release is recommended
  let shouldRelease = false;

  // Rule 1: Breaking changes should be released promptly
  if (breakdown.breaking > 0) {
    shouldRelease = true;
    reasons.push('⚠ Breaking changes should be released and communicated promptly');
  }

  // Rule 2: Security-related commits (look for keywords)
  const securityCommits = commits.filter(c =>
    /security|cve|vuln|exploit|xss|injection|auth.*(fix|patch)/i.test(c.message)
  );
  if (securityCommits.length > 0) {
    shouldRelease = true;
    reasons.push(`🔒 ${securityCommits.length} security-related commit(s) — release ASAP`);
  }

  // Rule 3: Accumulation threshold (5+ commits)
  if (commitCount >= 5) {
    shouldRelease = true;
    reasons.push(`${commitCount} unreleased commits — consider releasing to keep changes small and reviewable`);
  }

  // Rule 4: Staleness (14+ days since last release with any commits)
  if (daysSinceRelease !== null && daysSinceRelease >= 14 && commitCount > 0) {
    shouldRelease = true;
    reasons.push(`${daysSinceRelease} days since last release — regular cadence helps users stay current`);
  }

  // Rule 5: Feature accumulation (3+ features)
  if (breakdown.features >= 3) {
    shouldRelease = true;
    reasons.push('Multiple features accumulated — users are missing out');
  }

  // Rule 6: If only a couple of chores/minor, no urgency
  if (commitCount > 0 && commitCount < 5 && !shouldRelease) {
    reasons.push(`${commitCount} commit(s) since ${latestTag} — no urgency, but keep an eye on it`);
  }

  if (commitCount === 0) {
    reasons.push('No unreleased commits — you\'re up to date!');
  }

  const nextVersion = bumpVersion(latestTag, suggestedBump);

  return {
    shouldRelease,
    suggestedBump,
    currentVersion: latestTag,
    nextVersion,
    commitCount,
    contributorCount: contributors.size,
    daysSinceRelease,
    breakdown,
    reasons,
  };
}
