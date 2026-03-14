import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReleaseNotes, OutputFormat } from '../src/types';

// We test the publisher classes by mocking their external dependencies

const sampleNotes: ReleaseNotes = {
  version: 'v2.0.0',
  date: '2026-06-15',
  summary: 'Major release with new features.',
  changes: [
    { description: 'Add dark mode', category: 'features', ticketKey: 'PROJ-10' },
    { description: 'Fix login crash', category: 'fixes' },
  ],
  contributors: ['matt'],
  metadata: {
    commitCount: 8,
    prCount: 2,
    ticketCount: 1,
    generatedBy: 'cull',
    generatedAt: '2026-06-15T10:00:00Z',
  },
};

describe('StdoutPublisher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes formatted notes to stdout', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { StdoutPublisher } = await import('../src/publishers/index');

    const pub = new StdoutPublisher();
    await pub.publish(sampleNotes, 'markdown');

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('v2.0.0');
    expect(output).toContain('Add dark mode');
  });

  it('supports JSON format', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { StdoutPublisher } = await import('../src/publishers/index');

    const pub = new StdoutPublisher();
    await pub.publish(sampleNotes, 'json');

    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.version).toBe('v2.0.0');
  });
});

describe('FilePublisher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('can be instantiated with a path', async () => {
    const { FilePublisher } = await import('../src/publishers/index');
    const pub = new FilePublisher('RELEASE_NOTES.md');
    expect(pub).toBeDefined();
  });
});


