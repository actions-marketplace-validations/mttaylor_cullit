import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import {
  resolveLicense,
  isProviderAllowed,
  isPublisherAllowed,
  isEnrichmentAllowed,
  upgradeMessage,
  getTierLimits,
} from '@cullit/core';

describe('Gate — resolveLicense', () => {
  const savedKey = process.env.CULLIT_API_KEY;

  afterEach(() => {
    if (savedKey) process.env.CULLIT_API_KEY = savedKey;
    else delete process.env.CULLIT_API_KEY;
  });

  it('returns free tier when no key is set', () => {
    delete process.env.CULLIT_API_KEY;
    const license = resolveLicense();
    expect(license.tier).toBe('free');
    expect(license.valid).toBe(true);
  });

  it('returns pro tier for valid key format', () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'a'.repeat(32);
    const license = resolveLicense();
    expect(license.tier).toBe('pro');
    expect(license.valid).toBe(true);
  });

  it('returns invalid for bad key format', () => {
    process.env.CULLIT_API_KEY = 'bad_key';
    const license = resolveLicense();
    expect(license.tier).toBe('free');
    expect(license.valid).toBe(false);
    expect(license.message).toContain('Invalid');
  });

  it('trims whitespace from key', () => {
    process.env.CULLIT_API_KEY = '  clt_' + 'b'.repeat(32) + '  ';
    const license = resolveLicense();
    expect(license.tier).toBe('pro');
    expect(license.valid).toBe(true);
  });
});

describe('Gate — access checks', () => {
  const freeLicense = { tier: 'free' as const, valid: true };
  const proLicense = { tier: 'pro' as const, valid: true };
  const invalidPro = { tier: 'pro' as const, valid: false };

  it('allows "none" provider on free tier', () => {
    expect(isProviderAllowed('none', freeLicense)).toBe(true);
  });

  it('blocks "anthropic" on free tier', () => {
    expect(isProviderAllowed('anthropic', freeLicense)).toBe(false);
  });

  it('allows any provider on pro', () => {
    expect(isProviderAllowed('anthropic', proLicense)).toBe(true);
    expect(isProviderAllowed('openai', proLicense)).toBe(true);
    expect(isProviderAllowed('gemini', proLicense)).toBe(true);
  });

  it('blocks pro features when key is invalid', () => {
    expect(isProviderAllowed('anthropic', invalidPro)).toBe(false);
  });

  it('allows stdout/file publishers on free tier', () => {
    expect(isPublisherAllowed('stdout', freeLicense)).toBe(true);
    expect(isPublisherAllowed('file', freeLicense)).toBe(true);
  });

  it('blocks slack/discord/teams on free tier', () => {
    expect(isPublisherAllowed('slack', freeLicense)).toBe(false);
    expect(isPublisherAllowed('discord', freeLicense)).toBe(false);
    expect(isPublisherAllowed('teams', freeLicense)).toBe(false);
  });

  it('allows all publishers on pro', () => {
    expect(isPublisherAllowed('slack', proLicense)).toBe(true);
    expect(isPublisherAllowed('teams', proLicense)).toBe(true);
    expect(isPublisherAllowed('confluence', proLicense)).toBe(true);
    expect(isPublisherAllowed('notion', proLicense)).toBe(true);
  });

  it('blocks enrichment on free tier', () => {
    expect(isEnrichmentAllowed(freeLicense)).toBe(false);
  });

  it('allows enrichment on pro', () => {
    expect(isEnrichmentAllowed(proLicense)).toBe(true);
  });

  it('generates readable upgrade message', () => {
    const msg = upgradeMessage('AI provider "anthropic"');
    expect(msg).toContain('🔒');
    expect(msg).toContain('anthropic');
    expect(msg).toContain('cullit.io/pricing');
  });
});

describe('Gate — getTierLimits', () => {
  it('returns free tier limits', () => {
    const limits = getTierLimits('free');
    expect(limits.generationsPerMonth).toBe(3);
    expect(limits.maxProjects).toBe(1);
  });

  it('returns pro tier limits', () => {
    const limits = getTierLimits('pro');
    expect(limits.generationsPerMonth).toBe(500);
    expect(limits.maxProjects).toBe(5);
  });

  it('returns team tier limits', () => {
    const limits = getTierLimits('team');
    expect(limits.generationsPerMonth).toBe(2000);
    expect(limits.maxProjects).toBe(25);
  });

  it('returns enterprise tier limits', () => {
    const limits = getTierLimits('enterprise');
    expect(limits.generationsPerMonth).toBe(Infinity);
    expect(limits.maxProjects).toBe(Infinity);
  });

  it('falls back to free for unknown tier', () => {
    const limits = getTierLimits('nonexistent');
    expect(limits.generationsPerMonth).toBe(3);
    expect(limits.maxProjects).toBe(1);
  });
});
