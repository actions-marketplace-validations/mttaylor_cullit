import { describe, it, expect } from 'vitest';

// We can't import parseArgs directly (it's not exported), so we test it by extracting the logic.
// Instead, we replicate the parseArgs function here for unit testing.
// This mirrors the implementation in packages/cli/src/index.ts.

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.substring(1);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

describe('parseArgs', () => {
  it('parses long flags with values', () => {
    const result = parseArgs(['--from', 'v1.0.0', '--to', 'v1.1.0']);
    expect(result.from).toBe('v1.0.0');
    expect(result.to).toBe('v1.1.0');
  });

  it('parses short flags with values', () => {
    const result = parseArgs(['-f', 'v1.0.0', '-t', 'HEAD']);
    expect(result.f).toBe('v1.0.0');
    expect(result.t).toBe('HEAD');
  });

  it('parses boolean flags (no value)', () => {
    const result = parseArgs(['--dry-run', '--from', 'v1.0.0']);
    expect(result['dry-run']).toBe('true');
    expect(result.from).toBe('v1.0.0');
  });

  it('parses mixed long and short flags', () => {
    const result = parseArgs(['--from', 'v1.0.0', '-t', 'HEAD', '--format', 'json']);
    expect(result.from).toBe('v1.0.0');
    expect(result.t).toBe('HEAD');
    expect(result.format).toBe('json');
  });

  it('handles provider override', () => {
    const result = parseArgs(['--provider', 'gemini', '--from', 'HEAD~5']);
    expect(result.provider).toBe('gemini');
    expect(result.from).toBe('HEAD~5');
  });

  it('handles none provider', () => {
    const result = parseArgs(['--provider', 'none', '-f', 'v0.1.0']);
    expect(result.provider).toBe('none');
  });

  it('returns empty object for no args', () => {
    const result = parseArgs([]);
    expect(result).toEqual({});
  });

  it('handles trailing boolean flag', () => {
    const result = parseArgs(['--from', 'v1.0.0', '--dry-run']);
    expect(result.from).toBe('v1.0.0');
    expect(result['dry-run']).toBe('true');
  });

  it('handles audience override', () => {
    const result = parseArgs(['--audience', 'executive', '--from', 'v1.0.0']);
    expect(result.audience).toBe('executive');
  });

  it('handles source override', () => {
    const result = parseArgs(['--source', 'jira', '--from', 'project = PROJ']);
    expect(result.source).toBe('jira');
    expect(result.from).toBe('project = PROJ');
  });
});
