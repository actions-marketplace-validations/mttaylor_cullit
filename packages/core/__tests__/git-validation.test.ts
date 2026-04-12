import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import { GitCollector } from '../src/collectors/git';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execFileSync);

describe('GitCollector ref validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects refs with shell metacharacters', async () => {
    const collector = new GitCollector('/test');
    await expect(collector.collect('v1.0.0; rm -rf /', 'HEAD')).rejects.toThrow('Invalid git ref');
  });

  it('rejects refs with backticks', async () => {
    const collector = new GitCollector('/test');
    await expect(collector.collect('`whoami`', 'HEAD')).rejects.toThrow('Invalid git ref');
  });

  it('rejects refs with $() substitution', async () => {
    const collector = new GitCollector('/test');
    await expect(collector.collect('$(cat /etc/passwd)', 'HEAD')).rejects.toThrow('Invalid git ref');
  });

  it('rejects empty refs', async () => {
    const collector = new GitCollector('/test');
    await expect(collector.collect('', 'HEAD')).rejects.toThrow('Invalid git ref');
  });

  it('rejects overly long refs', async () => {
    const collector = new GitCollector('/test');
    await expect(collector.collect('a'.repeat(300), 'HEAD')).rejects.toThrow('Invalid git ref');
  });

  it('allows valid tag-like refs', async () => {
    const sep = '---CULLIT_COMMIT---';
    mockedExecSync
      .mockReturnValueOnce(`aaa111\x1eaaa\x1ematt\x1e2026-01-01\x1etest\x1e${sep}`)
      .mockReturnValueOnce('1 file changed');

    const collector = new GitCollector('/test');
    const diff = await collector.collect('v1.0.0', 'v2.0.0-rc.1');
    expect(diff.commits).toHaveLength(1);
  });

  it('allows HEAD~N syntax', async () => {
    const sep = '---CULLIT_COMMIT---';
    mockedExecSync
      .mockReturnValueOnce(`aaa111\x1eaaa\x1ematt\x1e2026-01-01\x1etest\x1e${sep}`)
      .mockReturnValueOnce('');

    const collector = new GitCollector('/test');
    const diff = await collector.collect('HEAD~10', 'HEAD');
    expect(diff.commits).toHaveLength(1);
  });

  it('allows branch names with slashes', async () => {
    const sep = '---CULLIT_COMMIT---';
    mockedExecSync
      .mockReturnValueOnce(`aaa111\x1eaaa\x1ematt\x1e2026-01-01\x1etest\x1e${sep}`)
      .mockReturnValueOnce('');

    const collector = new GitCollector('/test');
    const diff = await collector.collect('origin/main', 'feature/auth');
    expect(diff.commits).toHaveLength(1);
  });
});
