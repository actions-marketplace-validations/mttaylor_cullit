import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import { GitCollector, getRecentTags, getLatestTag } from '../src/collectors/git';

// Mock child_process to test parsing without a real git repo
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execFileSync);

describe('GitCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a single commit correctly', async () => {
    const separator = '---CULLIT_COMMIT---';
    const log = `abc123def456789a\x1eabc123d\x1ematt\x1e2026-03-12T10:00:00Z\x1efeat: add auth module\x1e${separator}`;

    mockedExecSync
      .mockReturnValueOnce(log)     // git log
      .mockReturnValueOnce(' 3 files changed, 42 insertions(+)\n'); // git diff --shortstat

    const collector = new GitCollector('/test');
    const diff = await collector.collect('v1.0.0', 'v1.1.0');

    expect(diff.from).toBe('v1.0.0');
    expect(diff.to).toBe('v1.1.0');
    expect(diff.commits).toHaveLength(1);
    expect(diff.commits[0].hash).toBe('abc123def456789a');
    expect(diff.commits[0].shortHash).toBe('abc123d');
    expect(diff.commits[0].author).toBe('matt');
    expect(diff.commits[0].message).toBe('feat: add auth module');
    expect(diff.filesChanged).toBe(3);
  });

  it('parses multiple commits', async () => {
    const sep = '---CULLIT_COMMIT---';
    const log = [
      `aaa111aaa111aaa1\x1eaaa111a\x1ealice\x1e2026-03-12\x1efeat: new feature\x1e${sep}`,
      `bbb222bbb222bbb2\x1ebbb222b\x1ebob\x1e2026-03-11\x1efix: bug fix\x1e${sep}`,
    ].join('\n');

    mockedExecSync
      .mockReturnValueOnce(log)
      .mockReturnValueOnce(' 5 files changed\n');

    const collector = new GitCollector('/test');
    const diff = await collector.collect('v1.0.0', 'v1.1.0');

    expect(diff.commits).toHaveLength(2);
    expect(diff.commits[0].author).toBe('alice');
    expect(diff.commits[1].author).toBe('bob');
  });

  it('extracts PR numbers from commit messages', async () => {
    const sep = '---CULLIT_COMMIT---';
    const log = `aaa111aaa111aaa1\x1eaaa111a\x1ematt\x1e2026-03-12\x1efeat: add auth (#42)\x1e${sep}`;

    mockedExecSync
      .mockReturnValueOnce(log)
      .mockReturnValueOnce('');

    const collector = new GitCollector('/test');
    const diff = await collector.collect('v1.0.0', 'v1.1.0');

    expect(diff.commits[0].prNumber).toBe(42);
  });

  it('extracts issue keys from commit messages', async () => {
    const sep = '---CULLIT_COMMIT---';
    const log = `aaa111aaa111aaa1\x1eaaa111a\x1ematt\x1e2026-03-12\x1efix: resolve PROJ-123 and ENG-456\x1e${sep}`;

    mockedExecSync
      .mockReturnValueOnce(log)
      .mockReturnValueOnce('');

    const collector = new GitCollector('/test');
    const diff = await collector.collect('v1.0.0', 'v1.1.0');

    expect(diff.commits[0].issueKeys).toContain('PROJ-123');
    expect(diff.commits[0].issueKeys).toContain('ENG-456');
  });

  it('deduplicates issue keys', async () => {
    const sep = '---CULLIT_COMMIT---';
    const log = `aaa111aaa111aaa1\x1eaaa111a\x1ematt\x1e2026-03-12\x1efix: PROJ-123 again PROJ-123\x1e${sep}`;

    mockedExecSync
      .mockReturnValueOnce(log)
      .mockReturnValueOnce('');

    const collector = new GitCollector('/test');
    const diff = await collector.collect('v1.0.0', 'v1.1.0');

    expect(diff.commits[0].issueKeys).toEqual(['PROJ-123']);
  });

  it('returns empty array for empty log', async () => {
    mockedExecSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce('');

    const collector = new GitCollector('/test');
    const diff = await collector.collect('v1.0.0', 'v1.1.0');

    expect(diff.commits).toHaveLength(0);
  });

  it('throws descriptive error on git failure', async () => {
    const err = new Error('git error') as any;
    err.stderr = Buffer.from('fatal: unknown revision');
    mockedExecSync.mockImplementation(() => { throw err; });

    const collector = new GitCollector('/test');
    await expect(collector.collect('v999.0.0', 'HEAD'))
      .rejects.toThrow('Check that both refs exist');
  });

  it('throws descriptive error when not a git repo', async () => {
    const err = new Error('git error') as any;
    err.stderr = Buffer.from('fatal: not a git repository');
    mockedExecSync.mockImplementation(() => { throw err; });

    const collector = new GitCollector('/test');
    await expect(collector.collect('v1.0.0', 'HEAD'))
      .rejects.toThrow('Run this command inside a git repository');
  });
});

describe('getRecentTags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed tags', () => {
    mockedExecSync.mockReturnValue('v2.0.0\nv1.1.0\nv1.0.0\n');
    const tags = getRecentTags('/test', 10);
    expect(tags).toEqual(['v2.0.0', 'v1.1.0', 'v1.0.0']);
  });

  it('limits count', () => {
    mockedExecSync.mockReturnValue('v3.0.0\nv2.0.0\nv1.0.0\n');
    const tags = getRecentTags('/test', 2);
    expect(tags).toEqual(['v3.0.0', 'v2.0.0']);
  });

  it('returns empty array on failure', () => {
    mockedExecSync.mockImplementation(() => { throw new Error('no git'); });
    const tags = getRecentTags('/test');
    expect(tags).toEqual([]);
  });
});

describe('getLatestTag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns latest tag', () => {
    mockedExecSync.mockReturnValue('v2.5.0\n');
    const tag = getLatestTag('/test');
    expect(tag).toBe('v2.5.0');
  });

  it('returns null on failure', () => {
    mockedExecSync.mockImplementation(() => { throw new Error('no tags'); });
    const tag = getLatestTag('/test');
    expect(tag).toBeNull();
  });
});
