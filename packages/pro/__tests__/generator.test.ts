import { describe, it, expect, vi } from 'vitest';
import { AIGenerator } from '../src/generators/ai';
import type { EnrichedContext, AIConfig } from '@cullit/core';

const mockContext: EnrichedContext = {
  diff: {
    from: 'v1.0.0',
    to: 'v1.1.0',
    commits: [
      {
        hash: 'abc123def456789',
        shortHash: 'abc123d',
        author: 'matt',
        date: '2026-03-12',
        message: 'feat: add Gemini provider support',
      },
      {
        hash: 'def456abc789012',
        shortHash: 'def456a',
        author: 'matt',
        date: '2026-03-11',
        message: 'fix: resolve Windows exit code issue',
      },
    ],
    filesChanged: 5,
  },
  tickets: [
    {
      key: 'PROJ-42',
      title: 'Windows exit code bug',
      type: 'bug',
      source: 'jira',
    },
  ],
};

const baseConfig: AIConfig = {
  provider: 'anthropic',
  audience: 'developer',
  tone: 'professional',
  categories: ['features', 'fixes', 'breaking', 'improvements', 'chores'],
};

describe('AIGenerator', () => {
  it('can be instantiated', () => {
    const gen = new AIGenerator();
    expect(gen).toBeDefined();
  });

  it('throws on missing API key', async () => {
    const savedKey = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];

    const gen = new AIGenerator();
    await expect(gen.generate(mockContext, baseConfig)).rejects.toThrow('No API key found');

    if (savedKey) process.env['ANTHROPIC_API_KEY'] = savedKey;
  });

  it('throws on unsupported provider', async () => {
    const gen = new AIGenerator();
    const badConfig = { ...baseConfig, provider: 'doesnotexist' as any };
    await expect(gen.generate(mockContext, badConfig)).rejects.toThrow('Unknown provider');
  });
});
