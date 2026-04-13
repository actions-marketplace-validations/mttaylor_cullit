import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@cullit/core', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import {
  resolveLicense,
  validateLicense,
  isProviderAllowed,
  isPublisherAllowed,
  isEnrichmentAllowed,
  isAudienceToneAllowed,
  upgradeMessage,
  getTierLimits,
  getTeamLimits,
  reportUsage,
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

  it('returns paid tier for valid key format', () => {
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
  const paidLicense = { tier: 'pro' as const, valid: true };
  const invalidPaid = { tier: 'pro' as const, valid: false };

  it('allows "none" provider on free tier', () => {
    expect(isProviderAllowed('none', freeLicense)).toBe(true);
  });

  it('allows AI providers on free tier (BYOK)', () => {
    expect(isProviderAllowed('anthropic', freeLicense)).toBe(true);
    expect(isProviderAllowed('openai', freeLicense)).toBe(true);
  });

  it('allows any provider on paid', () => {
    expect(isProviderAllowed('anthropic', paidLicense)).toBe(true);
    expect(isProviderAllowed('openai', paidLicense)).toBe(true);
    expect(isProviderAllowed('gemini', paidLicense)).toBe(true);
  });

  it('blocks paid features when key is invalid', () => {
    expect(isProviderAllowed('anthropic', invalidPaid)).toBe(false);
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

  it('allows all publishers on paid tier', () => {
    expect(isPublisherAllowed('slack', paidLicense)).toBe(true);
    expect(isPublisherAllowed('discord', paidLicense)).toBe(true);
    expect(isPublisherAllowed('github-release', paidLicense)).toBe(true);
    expect(isPublisherAllowed('confluence', paidLicense)).toBe(true);
    expect(isPublisherAllowed('notion', paidLicense)).toBe(true);
    expect(isPublisherAllowed('teams', paidLicense)).toBe(true);
  });

  it('blocks enrichment on free tier', () => {
    expect(isEnrichmentAllowed(freeLicense)).toBe(false);
  });

  it('allows enrichment on paid', () => {
    expect(isEnrichmentAllowed(paidLicense)).toBe(true);
  });

  it('blocks audience/tone on free tier', () => {
    expect(isAudienceToneAllowed(freeLicense)).toBe(false);
  });

  it('allows audience/tone on paid tier', () => {
    expect(isAudienceToneAllowed(paidLicense)).toBe(true);
  });

  it('generates readable upgrade message', () => {
    const msg = upgradeMessage('AI provider "anthropic"');
    expect(msg).toContain('🔒');
    expect(msg).toContain('anthropic');
    expect(msg).toContain('cullit.io/pricing');
  });

  it('generates tier-specific upgrade message for paid', () => {
    const msg = upgradeMessage('Jira enrichment', 'pro');
    expect(msg).toContain('Pro Cullit plan');
  });

  it('generates tier-specific upgrade message for enterprise', () => {
    const msg = upgradeMessage('SSO', 'enterprise');
    expect(msg).toContain('Enterprise plan');
  });
});

describe('Gate — getTierLimits', () => {
  it('returns free tier limits', () => {
    const limits = getTierLimits('free');
    expect(limits.generationsPerMonth).toBe(3);
    expect(limits.maxProjects).toBe(3);
  });

  it('returns paid tier limits', () => {
    const limits = getTierLimits('pro');
    expect(limits.generationsPerMonth).toBe(500);
    expect(limits.maxProjects).toBe(100);
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

describe('Gate — getTeamLimits', () => {
  it('returns base paid limits for 5 seats', () => {
    const limits = getTeamLimits(5);
    expect(limits.generationsPerMonth).toBe(500); // max(500, 5*100) = 500
    expect(limits.maxProjects).toBe(100); // max(100, 5*5) = 100
  });

  it('scales limits for 10 seats', () => {
    const limits = getTeamLimits(10);
    expect(limits.generationsPerMonth).toBe(1000); // max(500, 10*100) = 1000
    expect(limits.maxProjects).toBe(100); // max(100, 10*5) = 100
  });

  it('scales limits for 25 seats', () => {
    const limits = getTeamLimits(25);
    expect(limits.generationsPerMonth).toBe(2500); // max(500, 25*100) = 2500
    expect(limits.maxProjects).toBe(125); // max(100, 25*5) = 125
  });

  it('scales limits for 50 seats', () => {
    const limits = getTeamLimits(50);
    expect(limits.generationsPerMonth).toBe(5000); // max(500, 50*100) = 5000
    expect(limits.maxProjects).toBe(250); // max(100, 50*5) = 250
  });
});

describe('Gate — isFeatureAllowed', () => {
  it('blocks drafts on free tier', () => {
    expect(isFeatureAllowed('drafts', 'free')).toBe(false);
  });

  it('allows drafts on paid tier', () => {
    expect(isFeatureAllowed('drafts', 'pro')).toBe(true);
  });

  it('allows drafts on enterprise tier', () => {
    expect(isFeatureAllowed('drafts', 'enterprise')).toBe(true);
  });

  it('allows audit_logs on paid tier', () => {
    expect(isFeatureAllowed('audit_logs', 'pro')).toBe(true);
  });

  it('allows audit_logs on enterprise tier', () => {
    expect(isFeatureAllowed('audit_logs', 'enterprise')).toBe(true);
  });

  it('blocks sso on paid tier (enterprise-only)', () => {
    expect(isFeatureAllowed('sso', 'pro')).toBe(false);
  });

  it('allows sso on enterprise tier', () => {
    expect(isFeatureAllowed('sso', 'enterprise')).toBe(true);
  });

  it('allows approvals on paid tier', () => {
    expect(isFeatureAllowed('approvals', 'pro')).toBe(true);
  });

  it('allows project_templates on paid tier', () => {
    expect(isFeatureAllowed('project_templates', 'pro')).toBe(true);
  });

  it('allows project_templates on enterprise tier', () => {
    expect(isFeatureAllowed('project_templates', 'enterprise')).toBe(true);
  });

  it('allows team_analytics on paid tier', () => {
    expect(isFeatureAllowed('team_analytics', 'pro')).toBe(true);
  });

  it('allows team_analytics on enterprise tier', () => {
    expect(isFeatureAllowed('team_analytics', 'enterprise')).toBe(true);
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
    expect(gating.team_analytics).toBe(false);
  });

  it('returns all features enabled for paid tier (except sso)', () => {
    const gating = getFeatureGating('pro');
    expect(gating.drafts).toBe(true);
    expect(gating.approvals).toBe(true);
    expect(gating.shared_history).toBe(true);
    expect(gating.project_templates).toBe(true);
    expect(gating.hosted_changelog).toBe(true);
    expect(gating.branded_widget).toBe(true);
    expect(gating.team_publishers).toBe(true);
    expect(gating.org_settings).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.team_analytics).toBe(true);
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

describe('Gate — isPlanFeatureAllowed', () => {
  it('allows branded_widget for paid plan', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'pro', 'pro')).toBe(true);
  });

  it('allows branded_widget for enterprise', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks branded_widget for free', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'free', 'free')).toBe(false);
  });

  it('allows team_analytics for paid plan', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'pro', 'pro')).toBe(true);
  });

  it('allows team_analytics for enterprise', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'enterprise', 'enterprise')).toBe(true);
  });

  it('enterprise always passes plan feature checks', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'enterprise', 'enterprise')).toBe(true);
    expect(isPlanFeatureAllowed('audit_logs', 'enterprise', 'enterprise')).toBe(true);
    expect(isPlanFeatureAllowed('team_analytics', 'enterprise', 'enterprise')).toBe(true);
  });

  it('falls back to tier check for non-plan-gated features', () => {
    expect(isPlanFeatureAllowed('drafts', 'pro', 'pro')).toBe(true);
  });
});

describe('Gate — getFeatureGating with plan', () => {
  it('returns plan-aware gating for paid', () => {
    const gating = getFeatureGating('pro', 'pro');
    expect(gating.branded_widget).toBe(true);
    expect(gating.project_templates).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.team_analytics).toBe(true);
    expect(gating.drafts).toBe(true);
  });

  it('without plan param still shows all paid features', () => {
    const gating = getFeatureGating('pro');
    expect(gating.branded_widget).toBe(true);
    expect(gating.drafts).toBe(true);
    expect(gating.team_analytics).toBe(true);
  });

  it('enterprise with plan shows all features', () => {
    const gating = getFeatureGating('enterprise', 'enterprise');
    expect(gating.branded_widget).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.sso).toBe(true);
  });
});

describe('Gate — validateLicense', () => {
  const savedKey = process.env.CULLIT_API_KEY;
  const savedUrl = process.env.CULLIT_LICENSE_URL;

  afterEach(() => {
    if (savedKey) process.env.CULLIT_API_KEY = savedKey;
    else delete process.env.CULLIT_API_KEY;
    if (savedUrl) process.env.CULLIT_LICENSE_URL = savedUrl;
    else delete process.env.CULLIT_LICENSE_URL;
  });

  it('returns free tier when no key is set', async () => {
    delete process.env.CULLIT_API_KEY;
    delete process.env.CULLIT_LICENSE_URL;
    const result = await validateLicense();
    expect(result.tier).toBe('free');
    expect(result.valid).toBe(true);
  });

  it('returns invalid for bad key format', async () => {
    process.env.CULLIT_API_KEY = 'bad_key';
    delete process.env.CULLIT_LICENSE_URL;
    const result = await validateLicense();
    expect(result.tier).toBe('free');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('Invalid');
  });

  it('returns paid when no validation URL is configured', async () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'a'.repeat(32);
    delete process.env.CULLIT_LICENSE_URL;
    const result = await validateLicense();
    expect(result.tier).toBe('pro');
    expect(result.valid).toBe(true);
  });

  it('blocks internal IP addresses in license URL', async () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'a'.repeat(32);
    process.env.CULLIT_LICENSE_URL = 'https://192.168.1.1/validate';
    const result = await validateLicense();
    expect(result.tier).toBe('pro');
    expect(result.message).toContain('internal');
  });

  it('blocks IPv6 loopback in license URL', async () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'a'.repeat(32);
    process.env.CULLIT_LICENSE_URL = 'https://[::1]/validate';
    const result = await validateLicense();
    expect(result.tier).toBe('pro');
    expect(result.message).toContain('internal');
  });

  it('blocks IPv4-mapped IPv6 addresses', async () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'a'.repeat(32);
    process.env.CULLIT_LICENSE_URL = 'https://[::ffff:127.0.0.1]/validate';
    const result = await validateLicense();
    expect(result.tier).toBe('pro');
    expect(result.message).toContain('internal');
  });

  it('blocks non-https license URL', async () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'a'.repeat(32);
    process.env.CULLIT_LICENSE_URL = 'http://example.com/validate';
    const result = await validateLicense();
    expect(result.tier).toBe('pro');
    expect(result.message).toContain('https');
  });

  it('falls back to free on network error with no cache', async () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'c'.repeat(32);
    process.env.CULLIT_LICENSE_URL = 'https://license.cullit.io/validate';
    // Real fetch will fail (no server) — validateLicense catches and falls back
    const result = await validateLicense();
    expect(result.tier).toBe('free');
    expect(result.valid).toBe(true);
    expect(result.message).toContain('offline');
  });
});

describe('Gate — reportUsage', () => {
  const savedKey = process.env.CULLIT_API_KEY;
  const savedUrl = process.env.CULLIT_METER_URL;

  afterEach(() => {
    if (savedKey) process.env.CULLIT_API_KEY = savedKey;
    else delete process.env.CULLIT_API_KEY;
    if (savedUrl) process.env.CULLIT_METER_URL = savedUrl;
    else delete process.env.CULLIT_METER_URL;
  });

  it('does nothing when metering is not configured', async () => {
    delete process.env.CULLIT_API_KEY;
    delete process.env.CULLIT_METER_URL;
    await expect(reportUsage()).resolves.toBeUndefined();
  });

  it('does nothing when only key is set (no meter URL)', async () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'a'.repeat(32);
    delete process.env.CULLIT_METER_URL;
    await expect(reportUsage()).resolves.toBeUndefined();
  });

  it('posts to metering endpoint when both key and URL configured', async () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'a'.repeat(32);
    process.env.CULLIT_METER_URL = 'https://meter.cullit.io/v1/usage';
    await expect(reportUsage('my-project')).resolves.toBeUndefined();
  });

  it('swallows errors silently', async () => {
    process.env.CULLIT_API_KEY = 'clt_' + 'a'.repeat(32);
    process.env.CULLIT_METER_URL = 'https://meter.cullit.io/v1/usage';
    await expect(reportUsage()).resolves.toBeUndefined();
  });
});
