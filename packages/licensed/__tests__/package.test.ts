import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('@cullit/licensed package', () => {
  const root = resolve(__dirname, '..');

  it('package.json declares pro + cullit as deps and ships a bin', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('@cullit/licensed');
    expect(pkg.bin).toBeDefined();
    expect(pkg.dependencies?.['@cullit/pro']).toBeDefined();
    expect(pkg.dependencies?.['cullit']).toBeDefined();
  });

  it('entrypoint preloads @cullit/pro before cullit CLI', () => {
    const src = readFileSync(resolve(root, 'src/index.ts'), 'utf-8');
    const proIdx = src.indexOf("'@cullit/pro'");
    const cliIdx = src.indexOf("'cullit'");
    expect(proIdx).toBeGreaterThan(-1);
    expect(cliIdx).toBeGreaterThan(-1);
    expect(proIdx).toBeLessThan(cliIdx);
  });

  it('entrypoint starts with a node shebang', () => {
    const src = readFileSync(resolve(root, 'src/index.ts'), 'utf-8');
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('dist build artifact exists if built', () => {
    const dist = resolve(root, 'dist/index.js');
    if (existsSync(dist)) {
      const content = readFileSync(dist, 'utf-8');
      expect(content).toContain('@cullit/pro');
      expect(content).toContain('cullit');
    }
  });
});
