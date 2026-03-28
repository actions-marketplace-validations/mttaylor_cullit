/**
 * Cullit License Gating
 *
 * Free tier (no key):  provider=none, publish to stdout/file only
 * Pro tier (with key): all providers, all publishers, all enrichments
 *
 * validateLicense() performs async remote validation with caching.
 * resolveLicense() remains sync for quick format-only checks (display).
 */

import { fetchWithTimeout } from './fetch';

export type LicenseTier = 'free' | 'basic' | 'pro' | 'team' | 'enterprise';

export interface LicenseStatus {
  tier: LicenseTier;
  valid: boolean;
  message?: string;
}

const FREE_PROVIDERS = new Set(['none']);
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

  // SSRF protection: only allow https (or http for localhost dev)
  try {
    const parsed = new URL(validationUrl);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) {
      return { tier: 'pro', valid: true, message: 'CULLIT_LICENSE_URL must use https.' };
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
        tier: (data.tier === 'team' || data.tier === 'enterprise') ? data.tier : data.tier === 'pro' ? 'pro' : data.tier === 'basic' ? 'basic' : 'free',
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
 */
export function isProviderAllowed(provider: string, license: LicenseStatus): boolean {
  if (license.tier !== 'free' && license.valid) return true;
  return FREE_PROVIDERS.has(provider);
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
 */
export function upgradeMessage(feature: string): string {
  return `🔒 ${feature} requires a paid Cullit plan.\n` +
         `   Upgrade at https://cullit.io/pricing\n` +
         `   Then set CULLIT_API_KEY in your environment.`;
}

// --- Usage Metering ---

export interface UsageLimits {
  generationsPerMonth: number;
  maxProjects: number;
}

const TIER_LIMITS: Record<string, UsageLimits> = {
  free: { generationsPerMonth: 5, maxProjects: 3 },
  basic: { generationsPerMonth: 50, maxProjects: 10 },
  pro: { generationsPerMonth: 500, maxProjects: 100 },
  team: { generationsPerMonth: 2000, maxProjects: 250 },
  enterprise: { generationsPerMonth: Infinity, maxProjects: Infinity },
};

/**
 * Get usage limits for a license tier.
 */
export function getTierLimits(tier: string): UsageLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
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
  | 'sso';

const FEATURE_TIERS: Record<TeamFeature, Set<string>> = {
  drafts:             new Set(['team', 'enterprise']),
  approvals:          new Set(['team', 'enterprise']),
  shared_history:     new Set(['team', 'enterprise']),
  project_templates:  new Set(['team', 'enterprise']),
  hosted_changelog:   new Set(['pro', 'team', 'enterprise']),
  branded_widget:     new Set(['team', 'enterprise']),
  team_publishers:    new Set(['team', 'enterprise']),
  org_settings:       new Set(['team', 'enterprise']),
  audit_logs:         new Set(['enterprise']),
  sso:                new Set(['enterprise']),
};

/**
 * Check whether a license tier grants access to a Team/Enterprise feature.
 */
export function isFeatureAllowed(feature: TeamFeature, tier: string): boolean {
  const allowed = FEATURE_TIERS[feature];
  return allowed ? allowed.has(tier) : false;
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
