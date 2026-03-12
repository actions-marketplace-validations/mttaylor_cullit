import { describe, it, expect } from 'vitest';
import { formatNotes } from '../src/formatter';
import type { ReleaseNotes } from '../src/types';

const sampleNotes: ReleaseNotes = {
  version: 'v1.0.0',
  date: '2026-03-12',
  summary: 'First release with AI-powered notes.',
  changes: [
    { description: 'Add AI-powered release note generation', category: 'features' },
    { description: 'Fix exit code on Windows', category: 'fixes', ticketKey: 'PROJ-42' },
    { description: 'Drop legacy config format', category: 'breaking' },
    { description: 'Faster git log parsing', category: 'improvements' },
  ],
  contributors: ['matt', 'bot'],
  metadata: {
    commitCount: 15,
    prCount: 3,
    ticketCount: 2,
    generatedBy: 'cull',
    generatedAt: '2026-03-12T12:00:00Z',
  },
};

describe('formatNotes', () => {
  it('produces markdown with version header', () => {
    const md = formatNotes(sampleNotes, 'markdown');
    expect(md).toContain('## v1.0.0');
    expect(md).toContain('2026-03-12');
  });

  it('includes summary in markdown', () => {
    const md = formatNotes(sampleNotes, 'markdown');
    expect(md).toContain('First release with AI-powered notes.');
  });

  it('groups changes by category', () => {
    const md = formatNotes(sampleNotes, 'markdown');
    expect(md).toContain('Features');
    expect(md).toContain('Bug Fixes');
    expect(md).toContain('Breaking Changes');
    expect(md).toContain('Improvements');
  });

  it('includes ticket keys', () => {
    const md = formatNotes(sampleNotes, 'markdown');
    expect(md).toContain('PROJ-42');
  });

  it('lists contributors', () => {
    const md = formatNotes(sampleNotes, 'markdown');
    expect(md).toContain('@matt');
    expect(md).toContain('@bot');
  });

  it('produces valid JSON', () => {
    const jsonStr = formatNotes(sampleNotes, 'json');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.version).toBe('v1.0.0');
    expect(parsed.changes).toHaveLength(4);
  });

  it('produces HTML with tags', () => {
    const html = formatNotes(sampleNotes, 'html');
    expect(html).toContain('<');
    expect(html).toContain('v1.0.0');
  });
});
