import { describe, it, expect } from 'vitest';
import { formatNotes } from '../src/formatter';
import type { ReleaseNotes } from '../src/types';

describe('HTML XSS prevention', () => {
  const maliciousNotes: ReleaseNotes = {
    version: '<script>alert("xss")</script>',
    date: '2026-01-01',
    summary: '<img onerror=alert(1) src=x>',
    changes: [
      {
        description: '<b onmouseover="steal()">Hover me</b>',
        category: 'features',
        ticketKey: '"><script>document.cookie</script>',
      },
    ],
    contributors: ['attacker<script>'],
    metadata: {
      commitCount: 1,
      prCount: 0,
      ticketCount: 0,
      generatedBy: 'cull',
      generatedAt: '2026-01-01T00:00:00Z',
    },
  };

  it('escapes script tags in version', () => {
    const html = formatNotes(maliciousNotes, 'html');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in summary', () => {
    const html = formatNotes(maliciousNotes, 'html');
    // The < and > are escaped, so the img tag won't be parsed as HTML
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes HTML in change descriptions', () => {
    const html = formatNotes(maliciousNotes, 'html');
    // The < and > are escaped so the tag is not executable HTML
    expect(html).not.toContain('<b ');
    expect(html).toContain('&lt;b');
  });

  it('escapes HTML in ticket keys', () => {
    const html = formatNotes(maliciousNotes, 'html');
    // Script tags are fully escaped
    expect(html).not.toContain('<script>document.cookie</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  it('escapes markdown-special characters in text output', () => {
    const md = formatNotes(maliciousNotes, 'markdown');
    expect(md).not.toContain('<script>alert("xss")</script>');
    expect(md).toContain('&lt;script&gt;');
    expect(md).not.toContain('<img onerror=alert(1) src=x>');
    expect(md).toContain('&lt;img onerror=alert(1) src=x&gt;');
  });

  it('handles ampersands correctly', () => {
    const notes: ReleaseNotes = {
      version: 'v1.0.0',
      date: '2026-01-01',
      changes: [{ description: 'Fix R&D dashboard', category: 'fixes' }],
    };
    const html = formatNotes(notes, 'html');
    expect(html).toContain('R&amp;D');
    expect(html).not.toContain('R&D ');
  });

  it('handles quotes in descriptions', () => {
    const notes: ReleaseNotes = {
      version: 'v1.0.0',
      date: '2026-01-01',
      changes: [{ description: 'Add "dark mode" toggle', category: 'features' }],
    };
    const html = formatNotes(notes, 'html');
    expect(html).toContain('&quot;dark mode&quot;');
  });
});

describe('HTML metadata footer', () => {
  it('includes commit and PR counts', () => {
    const notes: ReleaseNotes = {
      version: 'v1.0.0',
      date: '2026-01-01',
      changes: [],
      metadata: {
        commitCount: 10,
        prCount: 3,
        ticketCount: 2,
        generatedBy: 'cull',
        generatedAt: '2026-01-01T00:00:00Z',
      },
    };
    const html = formatNotes(notes, 'html');
    expect(html).toContain('<footer>');
    expect(html).toContain('10 commits');
    expect(html).toContain('3 PRs');
  });
});
