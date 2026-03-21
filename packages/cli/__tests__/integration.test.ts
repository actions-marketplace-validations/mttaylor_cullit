import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';

const cliPath = resolve(process.cwd(), 'packages/cli/dist/index.js');
const cliBuilt = existsSync(cliPath);

// These tests require `pnpm build` to have run first (dist/index.js must exist).
// In CI the build step precedes `pnpm test`, so the dist is always present there.
// Locally, run `pnpm build` once before `pnpm test` to include these tests.
describe.skipIf(!cliBuilt)('CLI integration', () => {
  it('--version prints a semver string and exits 0', () => {
    const result = spawnSync(process.execPath, [cliPath, '--version'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('generate --from HEAD~2 --provider none exits 0 and outputs markdown', () => {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'generate', '--from', 'HEAD~2', '--to', 'HEAD', '--provider', 'none', '--quiet'],
      {
        encoding: 'utf-8',
        timeout: 30_000,
        // Run from workspace root so git commands resolve correctly
        cwd: resolve(process.cwd()),
      },
    );
    expect(result.status, result.stderr).toBe(0);
    // Output should include a markdown version heading
    expect(result.stdout).toMatch(/^##\s/m);
  });

  it('unknown command exits non-zero', () => {
    const result = spawnSync(process.execPath, [cliPath, 'unknown-cmd'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    expect(result.status).not.toBe(0);
  });

  it('generate without --from exits non-zero when no tags detected', () => {
    // Run in a temp dir with no git history so auto-detection also fails
    const result = spawnSync(
      process.execPath,
      [cliPath, 'generate'],
      {
        encoding: 'utf-8',
        timeout: 10_000,
        // Windows-compatible temp path
        cwd: process.env['TEMP'] || process.env['TMP'] || process.cwd(),
      },
    );
    expect(result.status).not.toBe(0);
  });
});
