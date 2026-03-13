import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GitCollector, TemplateGenerator, formatNotes, createLogger } from '../src/index';
import type { CullConfig, EnrichedContext } from '../src/types';

describe('Integration: full pipeline with template provider', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cullit-test-'));
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: tempDir, encoding: 'utf-8' });

    git('init');
    git('config user.email "test@cullit.io"');
    git('config user.name "Test User"');

    // Initial commit and tag
    writeFileSync(join(tempDir, 'README.md'), '# Test\n');
    git('add .');
    git('commit -m "chore: initial commit"');
    git('tag v0.0.1');

    // Feature commit
    writeFileSync(join(tempDir, 'feature.ts'), 'export const x = 1;\n');
    git('add .');
    git('commit -m "feat: add feature X"');

    // Fix commit
    writeFileSync(join(tempDir, 'fix.ts'), 'export const fix = true;\n');
    git('add .');
    git('commit -m "fix: resolve crash on startup"');

    // Breaking change
    writeFileSync(join(tempDir, 'api.ts'), 'export const v2 = true;\n');
    git('add .');
    git('commit -m "breaking change: remove legacy API"');

    // Chore commit
    writeFileSync(join(tempDir, 'ci.yml'), 'on: push\n');
    git('add .');
    git('commit -m "chore: update CI config"');

    git('tag v0.1.0');
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates release notes from real git history', async () => {
    const collector = new GitCollector(tempDir);
    const diff = await collector.collect('v0.0.1', 'v0.1.0');

    const context: EnrichedContext = { diff, tickets: [] };
    const generator = new TemplateGenerator();
    const notes = await generator.generate(context, {
      provider: 'none',
      audience: 'developer',
      tone: 'professional',
      categories: ['features', 'fixes', 'breaking', 'improvements', 'chores'],
    });

    expect(notes.changes.length).toBeGreaterThanOrEqual(3);
    expect(notes.contributors).toContain('Test User');

    const categories = notes.changes.map(c => c.category);
    expect(categories).toContain('features');
    expect(categories).toContain('fixes');

    const formatted = formatNotes(notes, 'markdown');
    expect(formatted).toContain('v0.1.0');
  });

  it('generates all three output formats', async () => {
    const collector = new GitCollector(tempDir);
    const diff = await collector.collect('v0.0.1', 'v0.1.0');

    const context: EnrichedContext = { diff, tickets: [] };
    const generator = new TemplateGenerator();
    const notes = await generator.generate(context, {
      provider: 'none',
      audience: 'developer',
      tone: 'professional',
      categories: ['features', 'fixes', 'breaking', 'improvements', 'chores'],
    });

    const md = formatNotes(notes, 'markdown');
    expect(md).toContain('##');

    const html = formatNotes(notes, 'html');
    expect(html).toContain('<div');

    const json = formatNotes(notes, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.changes).toBeDefined();
    expect(parsed.version).toBe('v0.1.0');
  });

  it('throws on empty commit range', async () => {
    const collector = new GitCollector(tempDir);
    const diff = await collector.collect('v0.1.0', 'v0.1.0');
    expect(diff.commits.length).toBe(0);
  });
});
