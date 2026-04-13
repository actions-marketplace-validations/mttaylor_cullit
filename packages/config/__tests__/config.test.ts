import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

  it('propagates errors instead of silently returning defaults', () => {
    const dir = join(tmpdir(), 'cullit-config-test-' + Date.now());
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, '.cullit.yml');
    // publish as a bare string causes normalizePublishTargets to throw (expects array)
    writeFileSync(configPath, 'publish: notAnArray\n', 'utf-8');

    try {
      expect(() => loadConfig(dir)).toThrow();
    } finally {
      unlinkSync(configPath);
    }
  });

  it('accepts direct file paths ending in .yml', () => {
    const dir = join(tmpdir(), 'cullit-config-test2-' + Date.now());
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'custom.yml');
    writeFileSync(configPath, 'ai:\n  provider: openai\n', 'utf-8');

    try {
      const config = loadConfig(configPath);
      expect(config.ai.provider).toBe('openai');
    } finally {
      unlinkSync(configPath);
    }
  });

  it('accepts direct file paths ending in .yaml', () => {
    const dir = join(tmpdir(), 'cullit-config-test4-' + Date.now());
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'custom.yaml');
    writeFileSync(configPath, 'ai:\n  provider: gemini\n', 'utf-8');

    try {
      const config = loadConfig(configPath);
      expect(config.ai.provider).toBe('gemini');
    } finally {
      unlinkSync(configPath);
    }
  });

  it('parses valid YAML config correctly', () => {
    const dir = join(tmpdir(), 'cullit-config-test3-' + Date.now());
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, '.cullit.yml');
    writeFileSync(configPath, [
      'ai:',
      '  provider: gemini',
      '  audience: executive',
      '  tone: casual',
      'source:',
      '  type: local',
      'publish:',
      '  - type: stdout',
    ].join('\n'), 'utf-8');

    try {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('gemini');
      expect(config.ai.audience).toBe('executive');
      expect(config.ai.tone).toBe('casual');
    } finally {
      unlinkSync(configPath);
    }
  });
});
