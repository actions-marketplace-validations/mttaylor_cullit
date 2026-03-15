import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('MultiRepoCollector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws if no repos provided', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');
    expect(() => new MultiRepoCollector([])).toThrow('at least one repo');
  });

  it('tags commits with repo name from local path', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');
    const { GitCollector } = await import('../src/collectors/git');

    // Mock GitCollector.collect to return fake commits
    vi.spyOn(GitCollector.prototype, 'collect').mockResolvedValue({
      from: 'v1.0.0',
      to: 'v1.1.0',
      commits: [
        { hash: 'abc123', shortHash: 'abc123', message: 'feat: add feature', author: 'matt', date: '2025-01-15T10:00:00Z' },
        { hash: 'def456', shortHash: 'def456', message: 'fix: bug fix', author: 'matt', date: '2025-01-14T10:00:00Z' },
      ],
      filesChanged: 5,
    });

    const collector = new MultiRepoCollector([
      { path: '/fake/repo', name: 'my-service' },
    ]);

    const result = await collector.collect('v1.0.0', 'v1.1.0');

    expect(result.commits).toHaveLength(2);
    expect(result.commits[0].message).toBe('[my-service] feat: add feature');
    expect(result.commits[1].message).toBe('[my-service] fix: bug fix');
    expect(result.filesChanged).toBe(5);
  });

  it('merges commits from multiple repos sorted by date', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');
    const { GitCollector } = await import('../src/collectors/git');

    let callCount = 0;
    vi.spyOn(GitCollector.prototype, 'collect').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          from: 'v1.0.0', to: 'v1.1.0',
          commits: [
            { hash: 'a1', shortHash: 'a1', message: 'repo1 old', author: 'a', date: '2025-01-10T10:00:00Z' },
            { hash: 'a2', shortHash: 'a2', message: 'repo1 new', author: 'a', date: '2025-01-20T10:00:00Z' },
          ],
          filesChanged: 3,
        };
      }
      return {
        from: 'v1.0.0', to: 'v1.1.0',
        commits: [
          { hash: 'b1', shortHash: 'b1', message: 'repo2 mid', author: 'b', date: '2025-01-15T10:00:00Z' },
        ],
        filesChanged: 2,
      };
    });

    const collector = new MultiRepoCollector([
      { path: '/repo1', name: 'alpha' },
      { path: '/repo2', name: 'beta' },
    ]);

    const result = await collector.collect('v1.0.0', 'v1.1.0');

    expect(result.commits).toHaveLength(3);
    // Should be sorted newest first
    expect(result.commits[0].message).toContain('repo1 new');
    expect(result.commits[1].message).toContain('repo2 mid');
    expect(result.commits[2].message).toContain('repo1 old');
    expect(result.filesChanged).toBe(5); // 3 + 2
  });

  it('uses per-repo from/to overrides', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');
    const { GitCollector } = await import('../src/collectors/git');

    const collectSpy = vi.spyOn(GitCollector.prototype, 'collect').mockResolvedValue({
      from: 'v2.0.0', to: 'v2.1.0',
      commits: [{ hash: 'x1', shortHash: 'x1', message: 'custom range', author: 'a', date: '2025-01-15T10:00:00Z' }],
      filesChanged: 1,
    });

    const collector = new MultiRepoCollector([
      { path: '/repo', name: 'custom', from: 'v2.0.0', to: 'v2.1.0' },
    ]);

    await collector.collect('v1.0.0', 'v1.1.0');

    expect(collectSpy).toHaveBeenCalledWith('v2.0.0', 'v2.1.0');
  });

  it('infers repo name from path', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');
    const { GitCollector } = await import('../src/collectors/git');

    vi.spyOn(GitCollector.prototype, 'collect').mockResolvedValue({
      from: 'v1.0.0', to: 'HEAD',
      commits: [{ hash: 'z1', shortHash: 'z1', message: 'test', author: 'a', date: '2025-01-15T10:00:00Z' }],
      filesChanged: 1,
    });

    const collector = new MultiRepoCollector([
      { path: '/home/user/projects/my-awesome-app' },
    ]);

    const result = await collector.collect('v1.0.0', 'HEAD');
    expect(result.commits[0].message).toBe('[my-awesome-app] test');
  });

  it('rejects invalid URLs', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');

    const collector = new MultiRepoCollector([
      { url: 'file:///etc/passwd', name: 'evil' },
    ]);

    await expect(collector.collect('v1', 'v2')).rejects.toThrow('Invalid repo URL');
  });

  it('rejects ftp URLs', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');

    const collector = new MultiRepoCollector([
      { url: 'ftp://malicious.host/repo', name: 'bad' },
    ]);

    await expect(collector.collect('v1', 'v2')).rejects.toThrow('Invalid repo URL');
  });

  it('requires url or path', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');

    const collector = new MultiRepoCollector([
      { name: 'missing-source' },
    ]);

    await expect(collector.collect('v1', 'v2')).rejects.toThrow('url" or "path');
  });

  it('is registered as multi-repo collector', async () => {
    const { hasCollector } = await import('../src/index');
    expect(hasCollector('multi-repo')).toBe(true);
  });

  it('preserves shortHash field in tagged commits', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');
    const { GitCollector } = await import('../src/collectors/git');

    vi.spyOn(GitCollector.prototype, 'collect').mockResolvedValue({
      from: 'v1.0.0', to: 'HEAD',
      commits: [{ hash: 'abcdef1234567890', shortHash: 'abcdef1', message: 'feat: something', author: 'a', date: '2025-01-15T10:00:00Z' }],
      filesChanged: 1,
    });

    const collector = new MultiRepoCollector([{ path: '/repo' }]);
    const result = await collector.collect('v1.0.0', 'HEAD');

    expect(result.commits[0].shortHash).toBe('abcdef1');
    expect(result.commits[0].hash).toBe('abcdef1234567890');
  });

  it('cleans up temp dirs even when collect fails', async () => {
    const { MultiRepoCollector } = await import('../src/collectors/multi-repo');
    const { GitCollector } = await import('../src/collectors/git');

    vi.spyOn(GitCollector.prototype, 'collect').mockRejectedValue(new Error('git failed'));

    const collector = new MultiRepoCollector([{ path: '/repo', name: 'test' }]);
    await expect(collector.collect('v1', 'v2')).rejects.toThrow('git failed');
  });
});
