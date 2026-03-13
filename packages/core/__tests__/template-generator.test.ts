import { describe, it, expect } from 'vitest';
import { TemplateGenerator } from '../src/generators/template';
import type { EnrichedContext, AIConfig } from '../src/types';

const baseConfig: AIConfig = {
  provider: 'none',
  audience: 'developer',
  tone: 'professional',
  categories: ['features', 'fixes', 'breaking', 'improvements', 'chores'],
};

function makeContext(messages: string[], tickets: { key: string; type?: string }[] = []): EnrichedContext {
  return {
    diff: {
      from: 'v1.0.0',
      to: 'v1.1.0',
      commits: messages.map((msg, i) => ({
        hash: `abc${i}`.padEnd(12, '0'),
        shortHash: `abc${i}`,
        author: 'matt',
        date: '2026-03-12',
        message: msg,
        issueKeys: msg.match(/\b([A-Z]+-\d+)\b/g) || undefined,
      })),
      filesChanged: messages.length,
    },
    tickets: tickets.map(t => ({
      key: t.key,
      title: `Ticket ${t.key}`,
      type: t.type,
      source: 'jira' as const,
    })),
  };
}

describe('TemplateGenerator', () => {
  it('categorizes conventional commits correctly', async () => {
    const ctx = makeContext([
      'feat: add dark mode',
      'fix: resolve login bug',
      'chore: update deps',
      'refactor: simplify auth flow',
    ]);
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);

    const cats = notes.changes.map(c => c.category);
    expect(cats).toContain('features');
    expect(cats).toContain('fixes');
    expect(cats).toContain('chores');
    expect(cats).toContain('improvements');
  });

  it('cleans conventional commit prefixes from descriptions', async () => {
    const ctx = makeContext(['feat(ui): add dark mode toggle']);
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);
    expect(notes.changes[0].description).toBe('Add dark mode toggle');
  });

  it('skips trivial commits (merge, wip, typo)', async () => {
    const ctx = makeContext([
      'Merge branch main',
      'WIP save progress',
      'feat: real feature',
    ]);
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);
    expect(notes.changes).toHaveLength(1);
    expect(notes.changes[0].description).toBe('Real feature');
  });

  it('deduplicates by ticket key', async () => {
    const ctx = makeContext([
      'fix: first attempt PROJ-42',
      'fix: second attempt PROJ-42',
      'feat: new thing PROJ-43',
    ]);
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);

    const ticketKeys = notes.changes.map(c => c.ticketKey).filter(Boolean);
    expect(ticketKeys.filter(k => k === 'PROJ-42')).toHaveLength(1);
    expect(ticketKeys).toContain('PROJ-43');
  });

  it('uses ticket type for categorization', async () => {
    const ctx = makeContext(
      ['some change PROJ-99'],
      [{ key: 'PROJ-99', type: 'bug' }]
    );
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);
    expect(notes.changes[0].category).toBe('fixes');
  });

  it('falls back to keyword-based categorization', async () => {
    const ctx = makeContext([
      'add new dashboard widget',
      'fix broken pagination',
      'remove deprecated endpoint',
      'update error messages',
    ]);
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);

    const cats = Object.fromEntries(
      notes.changes.map(c => [c.description.toLowerCase().split(' ')[0], c.category])
    );
    expect(cats['add']).toBe('features');
    expect(cats['fix']).toBe('fixes');
    expect(cats['remove']).toBe('chores');
    expect(cats['update']).toBe('improvements');
  });

  it('generates a summary', async () => {
    const ctx = makeContext(['feat: a', 'fix: b', 'fix: c']);
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);
    expect(notes.summary).toContain('1 feature');
    expect(notes.summary).toContain('2 fixes');
    expect(notes.summary).toContain('3 commits');
  });

  it('sets metadata.generatedBy to cullit-template', async () => {
    const ctx = makeContext(['feat: x']);
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);
    expect(notes.metadata?.generatedBy).toBe('cullit-template');
  });

  it('caps output at 20 entries', async () => {
    const messages = Array.from({ length: 30 }, (_, i) => `feat: feature ${i}`);
    const ctx = makeContext(messages);
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);
    expect(notes.changes.length).toBeLessThanOrEqual(20);
  });

  it('includes contributors', async () => {
    const ctx = makeContext(['feat: x']);
    const gen = new TemplateGenerator();
    const notes = await gen.generate(ctx, baseConfig);
    expect(notes.contributors).toContain('matt');
  });
});
