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
  isAudienceToneAllowed,
  upgradeMessage,
  getTierLimits,
  isFeatureAllowed,
  getFeatureGating,
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
  const basicLicense = { tier: 'basic' as const, valid: true };
  const proLicense = { tier: 'pro' as const, valid: true };
  const teamLicense = { tier: 'team' as const, valid: true };
  const invalidPro = { tier: 'pro' as const, valid: false };

  it('allows "none" provider on free tier', () => {
    expect(isProviderAllowed('none', freeLicense)).toBe(true);
  });

  it('blocks "anthropic" on free tier', () => {
    expect(isProviderAllowed('anthropic', freeLicense)).toBe(false);
  });

  it('allows any provider on basic', () => {
    expect(isProviderAllowed('anthropic', basicLicense)).toBe(true);
    expect(isProviderAllowed('openai', basicLicense)).toBe(true);
  });

  it('allows any provider on pro', () => {
    expect(isProviderAllowed('anthropic', proLicense)).toBe(true);
    expect(isProviderAllowed('openai', proLicense)).toBe(true);
    expect(isProviderAllowed('gemini', proLicense)).toBe(true);
  });

  it('allows any provider on team', () => {
    expect(isProviderAllowed('anthropic', teamLicense)).toBe(true);
  });

  it('blocks pro features when key is invalid', () => {
    expect(isProviderAllowed('anthropic', invalidPro)).toBe(false);
  });

  it('allows stdout/file publishers on free tier', () => {
    expect(isPublisherAllowed('stdout', freeLicense)).toBe(true);
    expect(isPublisherAllowed('file', freeLicense)).toBe(true);
  });

  it('allows stdout/file publishers on basic tier', () => {
    expect(isPublisherAllowed('stdout', basicLicense)).toBe(true);
    expect(isPublisherAllowed('file', basicLicense)).toBe(true);
  });

  it('allows slack/discord on basic tier', () => {
    expect(isPublisherAllowed('slack', basicLicense)).toBe(true);
    expect(isPublisherAllowed('discord', basicLicense)).toBe(true);
  });

  it('blocks confluence/notion/teams on basic tier (team-only)', () => {
    expect(isPublisherAllowed('confluence', basicLicense)).toBe(false);
    expect(isPublisherAllowed('notion', basicLicense)).toBe(false);
    expect(isPublisherAllowed('teams', basicLicense)).toBe(false);
  });

  it('blocks slack/discord/teams on free tier', () => {
    expect(isPublisherAllowed('slack', freeLicense)).toBe(false);
    expect(isPublisherAllowed('discord', freeLicense)).toBe(false);
    expect(isPublisherAllowed('teams', freeLicense)).toBe(false);
  });

  it('allows slack/discord/github-release on pro', () => {
    expect(isPublisherAllowed('slack', proLicense)).toBe(true);
    expect(isPublisherAllowed('discord', proLicense)).toBe(true);
    expect(isPublisherAllowed('github-release', proLicense)).toBe(true);
  });

  it('blocks confluence/notion/teams on pro tier (team-only)', () => {
    expect(isPublisherAllowed('confluence', proLicense)).toBe(false);
    expect(isPublisherAllowed('notion', proLicense)).toBe(false);
    expect(isPublisherAllowed('teams', proLicense)).toBe(false);
  });

  it('allows confluence/notion/teams on team tier', () => {
    expect(isPublisherAllowed('confluence', teamLicense)).toBe(true);
    expect(isPublisherAllowed('notion', teamLicense)).toBe(true);
    expect(isPublisherAllowed('teams', teamLicense)).toBe(true);
  });

  it('allows all publishers on team tier', () => {
    expect(isPublisherAllowed('slack', teamLicense)).toBe(true);
    expect(isPublisherAllowed('discord', teamLicense)).toBe(true);
    expect(isPublisherAllowed('confluence', teamLicense)).toBe(true);
    expect(isPublisherAllowed('notion', teamLicense)).toBe(true);
  });

  it('blocks enrichment on free tier', () => {
    expect(isEnrichmentAllowed(freeLicense)).toBe(false);
  });

  it('blocks enrichment on basic', () => {
    expect(isEnrichmentAllowed(basicLicense)).toBe(false);
  });

  it('allows enrichment on pro', () => {
    expect(isEnrichmentAllowed(proLicense)).toBe(true);
  });

  it('allows enrichment on team', () => {
    expect(isEnrichmentAllowed(teamLicense)).toBe(true);
  });

  it('blocks audience/tone on free tier', () => {
    expect(isAudienceToneAllowed(freeLicense)).toBe(false);
  });

  it('blocks audience/tone on basic tier', () => {
    expect(isAudienceToneAllowed(basicLicense)).toBe(false);
  });

  it('allows audience/tone on pro tier', () => {
    expect(isAudienceToneAllowed(proLicense)).toBe(true);
  });

  it('allows audience/tone on team tier', () => {
    expect(isAudienceToneAllowed(teamLicense)).toBe(true);
  });

  it('generates readable upgrade message', () => {
    const msg = upgradeMessage('AI provider "anthropic"');
    expect(msg).toContain('🔒');
    expect(msg).toContain('anthropic');
    expect(msg).toContain('cullit.io/pricing');
  });

  it('generates tier-specific upgrade message for Pro', () => {
    const msg = upgradeMessage('Jira enrichment', 'pro');
    expect(msg).toContain('Pro plan or above');
  });

  it('generates tier-specific upgrade message for Team', () => {
    const msg = upgradeMessage('drafts', 'team');
    expect(msg).toContain('Team plan or above');
  });
});

describe('Gate — getTierLimits', () => {
  it('returns free tier limits', () => {
    const limits = getTierLimits('free');
    expect(limits.generationsPerMonth).toBe(5);
    expect(limits.maxProjects).toBe(3);
  });

  it('returns basic tier limits', () => {
    const limits = getTierLimits('basic');
    expect(limits.generationsPerMonth).toBe(50);
    expect(limits.maxProjects).toBe(10);
  });

  it('returns pro tier limits', () => {
    const limits = getTierLimits('pro');
    expect(limits.generationsPerMonth).toBe(500);
    expect(limits.maxProjects).toBe(100);
  });

  it('returns team tier limits', () => {
    const limits = getTierLimits('team');
    expect(limits.generationsPerMonth).toBe(2000);
    expect(limits.maxProjects).toBe(250);
  });

  it('returns enterprise tier limits', () => {
    const limits = getTierLimits('enterprise');
    expect(limits.generationsPerMonth).toBe(Infinity);
    expect(limits.maxProjects).toBe(Infinity);
  });

  it('falls back to free for unknown tier', () => {
    const limits = getTierLimits('nonexistent');
    expect(limits.generationsPerMonth).toBe(5);
    expect(limits.maxProjects).toBe(3);
  });
});

describe('Gate — isFeatureAllowed', () => {
  it('blocks drafts on free tier', () => {
    expect(isFeatureAllowed('drafts', 'free')).toBe(false);
  });

  it('blocks drafts on pro tier', () => {
    expect(isFeatureAllowed('drafts', 'pro')).toBe(false);
  });

  it('allows drafts on team tier', () => {
    expect(isFeatureAllowed('drafts', 'team')).toBe(true);
  });

  it('allows drafts on enterprise tier', () => {
    expect(isFeatureAllowed('drafts', 'enterprise')).toBe(true);
  });

  it('blocks audit_logs on team tier (enterprise-only)', () => {
    expect(isFeatureAllowed('audit_logs', 'team')).toBe(false);
  });

  it('allows audit_logs on enterprise tier', () => {
    expect(isFeatureAllowed('audit_logs', 'enterprise')).toBe(true);
  });

  it('blocks sso on team tier (enterprise-only)', () => {
    expect(isFeatureAllowed('sso', 'team')).toBe(false);
  });

  it('allows sso on enterprise tier', () => {
    expect(isFeatureAllowed('sso', 'enterprise')).toBe(true);
  });

  it('allows approvals on team tier', () => {
    expect(isFeatureAllowed('approvals', 'team')).toBe(true);
  });

  it('allows project_templates on team tier', () => {
    expect(isFeatureAllowed('project_templates', 'team')).toBe(true);
  });
});

describe('Gate — getFeatureGating', () => {
  it('returns all features blocked for free tier', () => {
    const gating = getFeatureGating('free');
    expect(gating.drafts).toBe(false);
    expect(gating.approvals).toBe(false);
    expect(gating.hosted_changelog).toBe(false);
    expect(gating.sso).toBe(false);
    expect(gating.audit_logs).toBe(false);
  });

  it('returns hosted changelog blocked for basic tier', () => {
    const gating = getFeatureGating('basic');
    expect(gating.hosted_changelog).toBe(false);
    expect(gating.drafts).toBe(false);
    expect(gating.approvals).toBe(false);
    expect(gating.sso).toBe(false);
  });

  it('returns hosted changelog enabled for pro tier', () => {
    const gating = getFeatureGating('pro');
    expect(gating.hosted_changelog).toBe(true);
    expect(gating.drafts).toBe(false);
  });

  it('returns team features enabled for team tier', () => {
    const gating = getFeatureGating('team');
    expect(gating.drafts).toBe(true);
    expect(gating.approvals).toBe(true);
    expect(gating.shared_history).toBe(true);
    expect(gating.project_templates).toBe(true);
    expect(gating.hosted_changelog).toBe(true);
    expect(gating.branded_widget).toBe(true);
    expect(gating.team_publishers).toBe(true);
    expect(gating.org_settings).toBe(true);
    expect(gating.audit_logs).toBe(false);
    expect(gating.sso).toBe(false);
  });

  it('returns all features enabled for enterprise tier', () => {
    const gating = getFeatureGating('enterprise');
    expect(gating.drafts).toBe(true);
    expect(gating.approvals).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.sso).toBe(true);
  });
});
