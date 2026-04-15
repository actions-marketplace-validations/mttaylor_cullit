import { describe, it, expect, vi, afterEach } from 'vitest';

describe('API cache key', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('changes when the output format changes', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', '*');
    const { getCacheKey } = await import('../src/index');

    const config = {
      ai: {
        provider: 'none',
        audience: 'developer',
        tone: 'professional',
        categories: ['features', 'fixes'],
      },
      source: {
        type: 'local',
        enrichment: [],
      },
      publish: [{ type: 'stdout' }],
    };

    const markdownKey = getCacheKey('v1.0.0', 'HEAD', 'markdown', config);
    const htmlKey = getCacheKey('v1.0.0', 'HEAD', 'html', config);

    expect(markdownKey).not.toBe(htmlKey);
  });

  it('changes when categories or enrichment change', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', '*');
    const { getCacheKey } = await import('../src/index');

    const baseConfig = {
      ai: {
        provider: 'none',
        audience: 'developer',
        tone: 'professional',
        categories: ['features', 'fixes'],
      },
      source: {
        type: 'local',
        enrichment: [],
      },
      publish: [{ type: 'stdout' }],
    };

    const differentCategories = {
      ...baseConfig,
      ai: {
        ...baseConfig.ai,
        categories: ['breaking'],
      },
    };
    const differentEnrichment = {
      ...baseConfig,
      source: {
        ...baseConfig.source,
        enrichment: ['jira'],
      },
    };

    const baseKey = getCacheKey('v1.0.0', 'HEAD', 'markdown', baseConfig);
    const categoryKey = getCacheKey('v1.0.0', 'HEAD', 'markdown', differentCategories);
    const enrichmentKey = getCacheKey('v1.0.0', 'HEAD', 'markdown', differentEnrichment);

    expect(baseKey).not.toBe(categoryKey);
    expect(baseKey).not.toBe(enrichmentKey);
  });

  it('changes when userId changes (user isolation)', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', '*');
    const { getCacheKey } = await import('../src/index');

    const config = {
      ai: { provider: 'none', audience: 'developer', tone: 'professional', categories: ['features'] },
      source: { type: 'local', enrichment: [] },
      publish: [{ type: 'stdout' }],
    };

    const userAKey = getCacheKey('v1.0.0', 'HEAD', 'markdown', config, 'user-a');
    const userBKey = getCacheKey('v1.0.0', 'HEAD', 'markdown', config, 'user-b');
    const anonKey = getCacheKey('v1.0.0', 'HEAD', 'markdown', config);

    expect(userAKey).not.toBe(userBKey);
    expect(userAKey).not.toBe(anonKey);
  });
});