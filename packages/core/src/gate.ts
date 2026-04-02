/**
 * Cullit License Gating
 *
 * Free tier (no key):  3 AI gens/month, all providers (BYOK), publish to stdout/file only
 * Pro tier (with key): 500 gens/month, all providers, all publishers, enrichments, audience/tone
 * Team tier:           2000 gens/month, team management, advanced publishers
 * Team 25:             5000 gens/month, 500 projects, branded widget, project templates, audit logs
 * Enterprise tier:     unlimited everything
 *
 * validateLicense() performs async remote validation with caching.
 * resolveLicense() remains sync for quick format-only checks (display).
 */

import { fetchWithTimeout } from './fetch';

export type LicenseTier = 'free' | 'pro' | 'team' | 'enterprise';

export interface LicenseStatus {
  tier: LicenseTier;
  valid: boolean;
  message?: string;
}

// Free tier allows all AI providers (BYOK) — enforcement is via generation count, not provider blocking
const FREE_PUBLISHERS = new Set(['stdout', 'file']);
const TEAM_ONLY_PUBLISHERS = new Set(['confluence', 'notion', 'teams']);

// --- Remote validation cache ---
const LICENSE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours for successful validations
const LICENSE_FAILURE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for failures (retry sooner)
let cachedValidation: { status: LicenseStatus; key: string; expiresAt: number } | null = null;

/**
 * Resolve the user's license tier from CULLIT_API_KEY env var.
 * Sync format-only check — use for display, not enforcement.
 */
export function resolveLicense(): LicenseStatus {
  const key = process.env.CULLIT_API_KEY?.trim();

  if (!key) {
    return { tier: 'free', valid: true };
  }

  // Key format: clt_<32+ hex chars>
  if (!/^clt_[a-zA-Z0-9]{32,}$/.test(key)) {
    return { tier: 'free', valid: false, message: 'Invalid CULLIT_API_KEY format. Expected: clt_<key>' };
  }

  return { tier: 'pro', valid: true };
}

/**
 * Validate the license asynchronously with remote server validation.
 * Falls back to format-only check if offline or no validation URL configured.
 * Results are cached for 24 hours per key.
 */
export async function validateLicense(): Promise<LicenseStatus> {
  const key = process.env.CULLIT_API_KEY?.trim();
  const validationUrl = process.env.CULLIT_LICENSE_URL?.trim();

  // No key — free tier, skip remote check
  if (!key) {
    return { tier: 'free', valid: true };
  }

  // Format check first
  if (!/^clt_[a-zA-Z0-9]{32,}$/.test(key)) {
    return { tier: 'free', valid: false, message: 'Invalid CULLIT_API_KEY format. Expected: clt_<key>' };
  }

  // Return cached result if still valid for this key
  if (cachedValidation && cachedValidation.key === key && Date.now() < cachedValidation.expiresAt) {
    return cachedValidation.status;
  }

  // No validation URL configured — fall back to format-only
  if (!validationUrl) {
    return { tier: 'pro', valid: true };
  }

  // SSRF protection: only allow https (or http for localhost dev), block internal IPs
  try {
    const parsed = new URL(validationUrl);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) {
      return { tier: 'pro', valid: true, message: 'CULLIT_LICENSE_URL must use https.' };
    }
    // Block internal/private IP ranges
    const h = parsed.hostname;
    if (h === '0.0.0.0' || h === '[::]' || h === '[::1]' || h === '127.0.0.1' ||
        h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local') || h.endsWith('.internal')) {
      return { tier: 'pro', valid: true, message: 'CULLIT_LICENSE_URL must not point to internal addresses.' };
    }
  } catch {
    return { tier: 'pro', valid: true, message: 'CULLIT_LICENSE_URL is not a valid URL.' };
  }

  // Remote validation
  try {
    const res = await fetchWithTimeout(validationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ key }),
    }, 10_000);

    if (res.ok) {
      const data = await res.json() as { valid?: boolean; tier?: string; message?: string };
      const status: LicenseStatus = {
        tier: (data.tier === 'team' || data.tier === 'enterprise') ? data.tier : data.tier === 'pro' ? 'pro' : 'free',
        valid: data.valid !== false,
        message: data.message,
      };
      cachedValidation = { status, key, expiresAt: Date.now() + LICENSE_CACHE_TTL };
      return status;
    }

    // Server responded with error — key invalid, cache with short TTL
    const status: LicenseStatus = {
      tier: 'free',
      valid: false,
      message: 'License validation failed. Check your API key at https://cullit.io/pricing',
    };
    cachedValidation = { status, key, expiresAt: Date.now() + LICENSE_FAILURE_CACHE_TTL };
    return status;
  } catch {
    // Network error — use last cached result if available for this key
    if (cachedValidation && cachedValidation.key === key) {
      return cachedValidation.status;
    }
    // No cached result — fall back to free tier; connect to the internet to activate your license
    return { tier: 'free', valid: true, message: 'License validation unavailable offline. Run while connected to activate your Pro license.' };
  }
}

/**
 * Check whether the current license allows the requested provider.
 * All tiers now allow AI providers (BYOK) — enforcement is via generation limits.
 */
export function isProviderAllowed(provider: string, license: LicenseStatus): boolean {
  if (!license.valid) return provider === 'none';
  return true;
}

/**
 * Check whether the current license allows the requested publisher.
 * Confluence, Notion, and Teams require Team tier or above.
 */
export function isPublisherAllowed(publisherType: string, license: LicenseStatus): boolean {
  if (TEAM_ONLY_PUBLISHERS.has(publisherType)) {
    return (license.tier === 'team' || license.tier === 'enterprise') && license.valid;
  }
  if (license.tier !== 'free' && license.valid) return true;
  return FREE_PUBLISHERS.has(publisherType);
}

/**
 * Check whether the current license allows enrichment (Jira/Linear).
 * Requires Pro tier or above.
 */
export function isEnrichmentAllowed(license: LicenseStatus): boolean {
  return (license.tier === 'pro' || license.tier === 'team' || license.tier === 'enterprise') && license.valid;
}

/**
 * Check whether the current license allows audience & tone control.
 * Requires Pro tier or above.
 */
export function isAudienceToneAllowed(license: LicenseStatus): boolean {
  return (license.tier === 'pro' || license.tier === 'team' || license.tier === 'enterprise') && license.valid;
}

/**
 * Build a human-readable upgrade message for a gated feature.
 * @param feature - The feature name to include in the message.
 * @param minTier - Optional minimum tier required (e.g. 'pro', 'team').
 */
export function upgradeMessage(feature: string, minTier?: string): string {
  const tierLabel = minTier === 'team' ? 'a Team plan or above'
    : minTier === 'pro' ? 'a Pro plan or above'
    : minTier === 'enterprise' ? 'an Enterprise plan'
    : 'a paid Cullit plan';
  return `🔒 ${feature} requires ${tierLabel}.\n` +
         `   Upgrade at https://cullit.io/pricing\n` +
         `   Then set CULLIT_API_KEY in your environment.`;
}

// --- Usage Metering ---

export interface UsageLimits {
  generationsPerMonth: number;
  maxProjects: number;
}

const TIER_LIMITS: Record<string, UsageLimits> = {
  free: { generationsPerMonth: 3, maxProjects: 3 },
  pro: { generationsPerMonth: 500, maxProjects: 100 },
  team: { generationsPerMonth: 2000, maxProjects: 250 },
  enterprise: { generationsPerMonth: Infinity, maxProjects: Infinity },
};

/** Plan-specific limit overrides (e.g. team-25 gets higher limits than other team plans). */
const PLAN_LIMITS: Record<string, UsageLimits> = {
  'team-10': { generationsPerMonth: 4000, maxProjects: 350 },
  'team-25': { generationsPerMonth: 5000, maxProjects: 500 },
};

/**
 * Get usage limits for a license tier.
 */
export function getTierLimits(tier: string): UsageLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

/**
 * Get usage limits for a specific plan, falling back to tier defaults.
 * Use when the plan is known (API context); use getTierLimits when only tier is known (CLI).
 */
export function getPlanLimits(plan: string, tier: string): UsageLimits {
  return PLAN_LIMITS[plan] || TIER_LIMITS[tier] || TIER_LIMITS.free;
}

// --- Feature gating by tier ---

export type TeamFeature =
  | 'drafts'
  | 'approvals'
  | 'shared_history'
  | 'project_templates'
  | 'hosted_changelog'
  | 'branded_widget'
  | 'team_publishers'
  | 'org_settings'
  | 'audit_logs'
  | 'team_analytics'
  | 'sso';

const FEATURE_TIERS: Record<TeamFeature, Set<string>> = {
  drafts:             new Set(['team', 'enterprise']),
  approvals:          new Set(['team', 'enterprise']),
  shared_history:     new Set(['team', 'enterprise']),
  project_templates:  new Set(['enterprise']),       // plan-gated: team-25 via PLAN_FEATURES
  hosted_changelog:   new Set(['pro', 'team', 'enterprise']),
  branded_widget:     new Set(['enterprise']),        // plan-gated: team-25 via PLAN_FEATURES
  team_publishers:    new Set(['team', 'enterprise']),
  org_settings:       new Set(['team', 'enterprise']),
  audit_logs:         new Set(['enterprise']),        // plan-gated: team-25 via PLAN_FEATURES
  team_analytics:     new Set(['enterprise']),        // plan-gated: team-25 via PLAN_FEATURES
  sso:                new Set(['enterprise']),
};

/**
 * Plan-specific feature overrides — features gated to specific plans within a tier.
 * Enterprise always bypasses these checks.
 */
const PLAN_FEATURES: Record<string, Set<string>> = {
  branded_widget:    new Set(['team-25']),
  project_templates: new Set(['team-25']),
  audit_logs:        new Set(['team-25']),
  team_analytics:    new Set(['team-25']),
};

/**
 * Check whether a license tier grants access to a Team/Enterprise feature.
 */
export function isFeatureAllowed(feature: TeamFeature, tier: string, valid: boolean = true): boolean {
  if (!valid) return false;
  const allowed = FEATURE_TIERS[feature];
  return allowed ? allowed.has(tier) : false;
}

/**
 * Check whether a specific plan grants access to a feature.
 * Use when the plan is known (API context); enterprise always passes.
 * Falls back to tier-level check for features without plan restrictions.
 */
export function isPlanFeatureAllowed(feature: TeamFeature, plan: string, tier: string, valid: boolean = true): boolean {
  if (!valid) return false;
  if (tier === 'enterprise') return true;
  const planSet = PLAN_FEATURES[feature];
  if (planSet) return planSet.has(plan);
  const tierSet = FEATURE_TIERS[feature];
  return tierSet ? tierSet.has(tier) : false;
}

/**
 * Build a gating summary for a tier — which features are unlocked.
 */
export function getFeatureGating(tier: string): Record<TeamFeature, boolean> {
  const result: Record<string, boolean> = {};
  for (const feature of Object.keys(FEATURE_TIERS) as TeamFeature[]) {
    result[feature] = isFeatureAllowed(feature, tier);
  }
  return result as Record<TeamFeature, boolean>;
}

/**
 * Report a generation event to the metering service.
 * Non-blocking — failures are logged but never block the pipeline.
 */
export async function reportUsage(project: string = 'default'): Promise<void> {
  const key = process.env.CULLIT_API_KEY?.trim();
  const meterUrl = process.env.CULLIT_METER_URL?.trim();

  if (!meterUrl || !key) return; // No metering configured

  try {
    await fetchWithTimeout(meterUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        event: 'generation',
        project,
        timestamp: new Date().toISOString(),
      }),
    }, 5_000);
  } catch {
    // Metering is best-effort — never block the pipeline
  }
}
