import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('GitHub Action entrypoint', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
  });

  it('auto-detects from when omitted and writes outputs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cullit-action-test-'));
    const outputPath = join(tempDir, 'github-output.txt');

    const runPipeline = vi.fn().mockResolvedValue({
      notes: {
        version: 'HEAD',
        changes: [{ description: 'Added feature', category: 'features' }],
      },
      formatted: '## release notes',
      publishedTo: ['stdout'],
    });
    const getRecentTags = vi.fn().mockReturnValue(['v1.2.0', 'v1.1.0']);

    vi.doMock('@cullit/core', () => ({
      runPipeline,
      getRecentTags,
      DEFAULT_CATEGORIES: ['features', 'fixes', 'breaking', 'improvements', 'chores'],
    }));
    vi.doMock('@cullit/config', () => ({
      loadConfig: vi.fn().mockReturnValue({
        ai: {
          provider: 'none',
          audience: 'developer',
          tone: 'professional',
          categories: ['features', 'fixes', 'breaking', 'improvements', 'chores'],
        },
        source: { type: 'local' },
        publish: [{ type: 'stdout' }],
      }),
    }));

    process.env['GITHUB_OUTPUT'] = outputPath;
    process.env['INPUT_PROVIDER'] = 'none';
    delete process.env['INPUT_FROM'];
    delete process.env['INPUT_TO'];

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('./action');
    await mod.run();

    expect(getRecentTags).toHaveBeenCalled();
    expect(runPipeline).toHaveBeenCalledWith(
      'v1.2.0',
      'HEAD',
      expect.objectContaining({
        ai: expect.objectContaining({ provider: 'none' }),
        source: expect.objectContaining({ type: 'local' }),
      }),
      { format: 'markdown' }
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Auto-detected start ref: v1.2.0'));

    const output = readFileSync(outputPath, 'utf-8');
    expect(output).toContain('release-notes=## release notes');
    expect(output).toContain('version=HEAD');
    expect(output).toContain('change-count=1');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sets a failure when from is omitted and no tags exist', async () => {
    const runPipeline = vi.fn();
    const getRecentTags = vi.fn().mockReturnValue([]);

    vi.doMock('@cullit/core', () => ({
      runPipeline,
      getRecentTags,
      DEFAULT_CATEGORIES: ['features', 'fixes', 'breaking', 'improvements', 'chores'],
    }));
    vi.doMock('@cullit/config', () => ({
      loadConfig: vi.fn(),
    }));

    delete process.env['INPUT_FROM'];
    delete process.env['INPUT_TO'];

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('./action');
    await mod.run();

    expect(runPipeline).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no tags were found'));
  });
});