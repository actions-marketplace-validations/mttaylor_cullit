import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/index';

describe('loadConfig', () => {
  it('returns default config when no file exists', () => {
    // loadConfig falls back to defaults when file doesn't exist
    const config = loadConfig('/nonexistent/path');
    expect(config.ai).toBeDefined();
    expect(config.ai.provider).toBe('anthropic');
    expect(config.source.type).toBe('local');
    expect(config.publish).toBeDefined();
    expect(Array.isArray(config.publish)).toBe(true);
  });

  it('default config has expected shape', () => {
    const config = loadConfig('/nonexistent/path');
    expect(config.ai.audience).toBe('developer');
    expect(config.ai.tone).toBe('professional');
    expect(config.ai.categories).toContain('features');
    expect(config.ai.categories).toContain('fixes');
  });
});
