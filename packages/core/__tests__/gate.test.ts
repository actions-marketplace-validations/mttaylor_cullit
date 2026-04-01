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
  getPlanLimits,
  isFeatureAllowed,
  isPlanFeatureAllowed,
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
  const proLicense = { tier: 'pro' as const, valid: true };
  const teamLicense = { tier: 'team' as const, valid: true };
  const invalidPro = { tier: 'pro' as const, valid: false };

  it('allows "none" provider on free tier', () => {
    expect(isProviderAllowed('none', freeLicense)).toBe(true);
  });

  it('allows AI providers on free tier (BYOK)', () => {
    expect(isProviderAllowed('anthropic', freeLicense)).toBe(true);
    expect(isProviderAllowed('openai', freeLicense)).toBe(true);
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

  it('allows enrichment on pro', () => {
    expect(isEnrichmentAllowed(proLicense)).toBe(true);
  });

  it('allows enrichment on team', () => {
    expect(isEnrichmentAllowed(teamLicense)).toBe(true);
  });

  it('blocks audience/tone on free tier', () => {
    expect(isAudienceToneAllowed(freeLicense)).toBe(false);
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
    expect(limits.generationsPerMonth).toBe(3);
    expect(limits.maxProjects).toBe(3);
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
    expect(limits.generationsPerMonth).toBe(3);
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

  it('blocks project_templates on team tier (plan-gated to team-25)', () => {
    expect(isFeatureAllowed('project_templates', 'team')).toBe(false);
  });

  it('allows project_templates on enterprise tier', () => {
    expect(isFeatureAllowed('project_templates', 'enterprise')).toBe(true);
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
    expect(gating.project_templates).toBe(false); // plan-gated: team-25 only
    expect(gating.hosted_changelog).toBe(true);
    expect(gating.branded_widget).toBe(false);     // plan-gated: team-25 only
    expect(gating.team_publishers).toBe(true);
    expect(gating.org_settings).toBe(true);
    expect(gating.audit_logs).toBe(false);          // plan-gated: team-25 only
    expect(gating.team_analytics).toBe(false);       // plan-gated: team-25 only
    expect(gating.sso).toBe(false);
  });

  it('returns all features enabled for enterprise tier', () => {
    const gating = getFeatureGating('enterprise');
    expect(gating.drafts).toBe(true);
    expect(gating.approvals).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.team_analytics).toBe(true);
    expect(gating.sso).toBe(true);
  });
});

describe('Gate — getPlanLimits', () => {
  it('returns team-25 upgraded limits', () => {
    const limits = getPlanLimits('team-25', 'team');
    expect(limits.generationsPerMonth).toBe(5000);
    expect(limits.maxProjects).toBe(500);
  });

  it('falls back to tier limits for team-5', () => {
    const limits = getPlanLimits('team-5', 'team');
    expect(limits.generationsPerMonth).toBe(2000);
    expect(limits.maxProjects).toBe(250);
  });

  it('falls back to tier limits for team-10', () => {
    const limits = getPlanLimits('team-10', 'team');
    expect(limits.generationsPerMonth).toBe(2000);
    expect(limits.maxProjects).toBe(250);
  });
});

describe('Gate — isPlanFeatureAllowed', () => {
  it('allows branded_widget for team-25', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'team-25', 'team')).toBe(true);
  });

  it('blocks branded_widget for team-5', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'team-5', 'team')).toBe(false);
  });

  it('blocks branded_widget for team-10', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'team-10', 'team')).toBe(false);
  });

  it('allows audit_logs for team-25', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'team-25', 'team')).toBe(true);
  });

  it('blocks audit_logs for team-5', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'team-5', 'team')).toBe(false);
  });

  it('allows project_templates for team-25', () => {
    expect(isPlanFeatureAllowed('project_templates', 'team-25', 'team')).toBe(true);
  });

  it('allows team_analytics for team-25', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'team-25', 'team')).toBe(true);
  });

  it('blocks team_analytics for team-5', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'team-5', 'team')).toBe(false);
  });

  it('blocks team_analytics for team-10', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'team-10', 'team')).toBe(false);
  });

  it('enterprise always passes plan feature checks', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'enterprise', 'enterprise')).toBe(true);
    expect(isPlanFeatureAllowed('audit_logs', 'enterprise', 'enterprise')).toBe(true);
    expect(isPlanFeatureAllowed('team_analytics', 'enterprise', 'enterprise')).toBe(true);
  });

  it('falls back to tier check for non-plan-gated features', () => {
    expect(isPlanFeatureAllowed('drafts', 'team-5', 'team')).toBe(true);
    expect(isPlanFeatureAllowed('drafts', 'pro', 'pro')).toBe(false);
  });
});
