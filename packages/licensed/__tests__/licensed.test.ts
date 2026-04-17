import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('@cullit/licensed', () => {
  it('dist entry point exists after build', () => {
    const distPath = resolve(__dirname, '..', 'dist', 'index.js');
    expect(existsSync(distPath)).toBe(true);
  });

  it('package.json has correct bin entry', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(pkg.default.bin).toHaveProperty('cullit');
    expect(pkg.default.bin.cullit).toBe('./dist/index.js');
  });

  it('package.json exports ESM entry', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(pkg.default.exports['.']).toHaveProperty('import');
  });
});
