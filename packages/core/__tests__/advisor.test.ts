import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

// Import after mock
import { analyzeReleaseReadiness } from '../src/advisor';

describe('analyzeReleaseReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns first-release advisory when no tags exist', () => {
    // getLatestTag fails
    mockedExecFileSync.mockImplementation(() => { throw new Error('no tags'); });

    const advisory = analyzeReleaseReadiness('/test');

    expect(advisory.shouldRelease).toBe(true);
    expect(advisory.currentVersion).toBeNull();
    expect(advisory.reasons[0]).toContain('No tags');
  });

  it('reports no urgency with few chore commits', () => {
    const sep = '---CULLIT_COMMIT---';
    // Use dynamic dates relative to now so the test never crosses the 14-day staleness threshold
    const now = new Date();
    const tagDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
    const commit1Date = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const commit2Date = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const tagIso = tagDate.toISOString();
    const c1Iso = commit1Date.toISOString().slice(0, 10);
    const c2Iso = commit2Date.toISOString().slice(0, 10);

    mockedExecFileSync.mockImplementation((_cmd: any, args: any) => {
      const argsArr = args as string[];
      if (argsArr.includes('describe')) return 'v1.0.0\n';
      if (argsArr.includes('-1') && argsArr.some((a: string) => a.includes('%aI'))) return `${tagIso}\n`;
      if (argsArr.includes('--no-merges')) {
        return [
          `aaa\x1eaaa\x1ematt\x1e${c1Iso}\x1echore: update deps\x1e${sep}`,
          `bbb\x1ebbb\x1ematt\x1e${c2Iso}\x1edocs: fix typo\x1e${sep}`,
        ].join('\n');
      }
      if (argsArr.includes('tag')) return 'v1.0.0\n';
      return '';
    });

    const advisory = analyzeReleaseReadiness('/test');

    expect(advisory.currentVersion).toBe('v1.0.0');
    expect(advisory.commitCount).toBe(2);
    expect(advisory.shouldRelease).toBe(false);
    expect(advisory.suggestedBump).toBe('patch');
    expect(advisory.breakdown.chores).toBe(2);
  });

  it('recommends minor bump when features are present', () => {
    const sep = '---CULLIT_COMMIT---';

    mockedExecFileSync.mockImplementation((_cmd: any, args: any) => {
      const argsArr = args as string[];
      if (argsArr.includes('describe')) return 'v1.0.0\n';
      if (argsArr.includes('-1') && argsArr.some((a: string) => a.includes('%aI'))) return '2026-03-01T00:00:00Z\n';
      if (argsArr.includes('--no-merges')) {
        return [
          `aaa\x1eaaa\x1ealice\x1e2026-03-12\x1efeat: add SSO support\x1e${sep}`,
          `bbb\x1ebbb\x1ebob\x1e2026-03-11\x1efix: login crash\x1e${sep}`,
          `ccc\x1eccc\x1ealice\x1e2026-03-10\x1efeat: add dark mode\x1e${sep}`,
          `ddd\x1eddd\x1ealice\x1e2026-03-09\x1efeat: add export\x1e${sep}`,
          `eee\x1eeee\x1ebob\x1e2026-03-08\x1echore: deps\x1e${sep}`,
        ].join('\n');
      }
      if (argsArr.includes('tag')) return 'v1.0.0\n';
      return '';
    });

    const advisory = analyzeReleaseReadiness('/test');

    expect(advisory.suggestedBump).toBe('minor');
    expect(advisory.shouldRelease).toBe(true);
    expect(advisory.nextVersion).toBe('v1.1.0');
    expect(advisory.breakdown.features).toBe(3);
    expect(advisory.breakdown.fixes).toBe(1);
    expect(advisory.contributorCount).toBe(2);
  });

  it('recommends major bump for breaking changes', () => {
    const sep = '---CULLIT_COMMIT---';

    mockedExecFileSync.mockImplementation((_cmd: any, args: any) => {
      const argsArr = args as string[];
      if (argsArr.includes('describe')) return 'v2.0.0\n';
      if (argsArr.includes('-1') && argsArr.some((a: string) => a.includes('%aI'))) return '2026-03-11T00:00:00Z\n';
      if (argsArr.includes('--no-merges')) {
        return `aaa\x1eaaa\x1ematt\x1e2026-03-12\x1efeat!: redesign config format\x1e${sep}\n`;
      }
      if (argsArr.includes('tag')) return 'v2.0.0\n';
      return '';
    });

    const advisory = analyzeReleaseReadiness('/test');

    expect(advisory.suggestedBump).toBe('major');
    expect(advisory.shouldRelease).toBe(true);
    expect(advisory.nextVersion).toBe('v3.0.0');
    expect(advisory.breakdown.breaking).toBe(1);
  });

  it('flags security commits as urgent', () => {
    const sep = '---CULLIT_COMMIT---';

    mockedExecFileSync.mockImplementation((_cmd: any, args: any) => {
      const argsArr = args as string[];
      if (argsArr.includes('describe')) return 'v1.0.0\n';
      if (argsArr.includes('-1') && argsArr.some((a: string) => a.includes('%aI'))) return '2026-03-11T00:00:00Z\n';
      if (argsArr.includes('--no-merges')) {
        return `aaa\x1eaaa\x1ematt\x1e2026-03-12\x1efix: security vulnerability in auth\x1e${sep}\n`;
      }
      if (argsArr.includes('tag')) return 'v1.0.0\n';
      return '';
    });

    const advisory = analyzeReleaseReadiness('/test');

    expect(advisory.shouldRelease).toBe(true);
    expect(advisory.reasons.some(r => r.includes('security'))).toBe(true);
  });

  it('flags stale repos (14+ days with commits)', () => {
    const sep = '---CULLIT_COMMIT---';
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

    mockedExecFileSync.mockImplementation((_cmd: any, args: any) => {
      const argsArr = args as string[];
      if (argsArr.includes('describe')) return 'v1.0.0\n';
      if (argsArr.includes('-1') && argsArr.some((a: string) => a.includes('%aI'))) return `${oldDate}\n`;
      if (argsArr.includes('--no-merges')) {
        return `aaa\x1eaaa\x1ematt\x1e2026-03-01\x1echore: update deps\x1e${sep}\n`;
      }
      if (argsArr.includes('tag')) return 'v1.0.0\n';
      return '';
    });

    const advisory = analyzeReleaseReadiness('/test');

    expect(advisory.shouldRelease).toBe(true);
    expect(advisory.daysSinceRelease).toBeGreaterThanOrEqual(14);
    expect(advisory.reasons.some(r => r.includes('days since last release'))).toBe(true);
  });

  it('reports up-to-date when no unreleased commits', () => {
    mockedExecFileSync.mockImplementation((_cmd: any, args: any) => {
      const argsArr = args as string[];
      if (argsArr.includes('describe')) return 'v1.2.3\n';
      if (argsArr.includes('-1') && argsArr.some((a: string) => a.includes('%aI'))) return '2026-03-12T00:00:00Z\n';
      if (argsArr.includes('--no-merges')) return '';
      if (argsArr.includes('tag')) return 'v1.2.3\n';
      return '';
    });

    const advisory = analyzeReleaseReadiness('/test');

    expect(advisory.shouldRelease).toBe(false);
    expect(advisory.commitCount).toBe(0);
    expect(advisory.reasons.some(r => r.includes('up to date'))).toBe(true);
  });

  it('calculates next version correctly', () => {
    const sep = '---CULLIT_COMMIT---';

    mockedExecFileSync.mockImplementation((_cmd: any, args: any) => {
      const argsArr = args as string[];
      if (argsArr.includes('describe')) return 'v2.3.4\n';
      if (argsArr.includes('-1') && argsArr.some((a: string) => a.includes('%aI'))) return '2026-03-11T00:00:00Z\n';
      if (argsArr.includes('--no-merges')) {
        return `aaa\x1eaaa\x1ematt\x1e2026-03-12\x1efix: typo\x1e${sep}\n`;
      }
      if (argsArr.includes('tag')) return 'v2.3.4\n';
      return '';
    });

    const advisory = analyzeReleaseReadiness('/test');

    expect(advisory.currentVersion).toBe('v2.3.4');
    expect(advisory.nextVersion).toBe('v2.3.5');
    expect(advisory.suggestedBump).toBe('patch');
  });
});
