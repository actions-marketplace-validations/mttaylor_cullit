import { describe, it, expect, vi, afterEach } from 'vitest';
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

  describe('response parsing across providers', () => {
    const validJson = JSON.stringify({
      summary: 'A release.',
      changes: [{ description: 'Add feature', category: 'features', ticketKey: null }],
    });

    function mockProviderResponse(provider: AIConfig['provider'], text: string) {
      const payloadByProvider: Record<string, unknown> = {
        anthropic: { content: [{ text }] },
        openai: { choices: [{ message: { content: text } }] },
        gemini: { candidates: [{ content: { parts: [{ text }] } }] },
        ollama: { message: { content: text } },
      };
      return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payloadByProvider[provider as string],
        text: async () => '',
      } as Response);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('parses bare JSON from OpenAI', async () => {
      mockProviderResponse('openai', validJson);
      const gen = new AIGenerator();
      const notes = await gen.generate(mockContext, { ...baseConfig, provider: 'openai', apiKey: 'sk-test' });
      expect(notes.summary).toBe('A release.');
      expect(notes.changes).toHaveLength(1);
    });

    it.each(['anthropic', 'gemini', 'ollama'] as const)(
      'parses prose-wrapped JSON from %s',
      async (provider) => {
        const wrapped = `Sure! Here are the release notes:\n\n${validJson}\n\nLet me know if you need changes.`;
        mockProviderResponse(provider, wrapped);
        const gen = new AIGenerator();
        const notes = await gen.generate(mockContext, { ...baseConfig, provider, apiKey: 'test-key' });
        expect(notes.summary).toBe('A release.');
        expect(notes.changes).toHaveLength(1);
      },
    );

    it('still throws when no JSON object is present', async () => {
      mockProviderResponse('anthropic', 'I could not generate release notes.');
      const gen = new AIGenerator();
      await expect(
        gen.generate(mockContext, { ...baseConfig, provider: 'anthropic', apiKey: 'test-key' }),
      ).rejects.toThrow('Failed to parse AI response as JSON');
    });
  });
});
