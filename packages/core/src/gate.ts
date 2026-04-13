/**
 * Cullit License Gating
 *
 * Free tier (no key):  3 AI gens/month, all providers (BYOK), publish to stdout/file only
 * Pro tier (with key):  all features, per-seat limits (100 gens/seat, 5 projects/seat)
 * Enterprise tier:     unlimited everything
 *
 * validateLicense() performs async remote validation with caching.
 * resolveLicense() remains sync for quick format-only checks (display).
 */

import { fetchWithTimeout } from './fetch';
import { PRO_MIN_SEATS } from './constants';

export type LicenseTier = 'free' | 'pro' | 'enterprise';

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
 * Check whether a URL hostname resolves to an internal/private address.
 * Blocks RFC1918, loopback, link-local, IPv6 private ranges, and metadata endpoints.
 */
function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  // IPv4 private ranges + loopback
  if (h === '0.0.0.0' || h === '127.0.0.1' ||
      h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // IPv6 loopback, unspecified, link-local, unique local, IPv4-mapped
  if (h === '[::]' || h === '[::1]' ||
      h.startsWith('[::ffff:') || h.startsWith('[fc') || h.startsWith('[fd') ||
      h.startsWith('[fe80:') || h.startsWith('[fe80')) return true;
  // DNS-based private names
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  return false;
}

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
    if (isInternalHost(parsed.hostname)) {
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
      // Map legacy tier names to new model
      const rawTier = data.tier;
      const tier: LicenseTier = rawTier === 'enterprise' ? 'enterprise'
        : (rawTier === 'pro' || rawTier === 'paid' || rawTier === 'team') ? 'pro'
        : 'free';
      const status: LicenseStatus = {
        tier,
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
 * Confluence, Notion, and Teams require Pro tier or above.
 */
export function isPublisherAllowed(publisherType: string, license: LicenseStatus): boolean {
  if (TEAM_ONLY_PUBLISHERS.has(publisherType)) {
    return (license.tier === 'pro' || license.tier === 'enterprise') && license.valid;
  }
  if (license.tier !== 'free' && license.valid) return true;
  return FREE_PUBLISHERS.has(publisherType);
}

/**
 * Check whether the current license allows enrichment (Jira/Linear).
 * Requires Pro tier or above.
 */
export function isEnrichmentAllowed(license: LicenseStatus): boolean {
  return (license.tier === 'pro' || license.tier === 'enterprise') && license.valid;
}

/**
 * Check whether the current license allows audience & tone control.
 * Requires Pro tier or above.
 */
export function isAudienceToneAllowed(license: LicenseStatus): boolean {
  return (license.tier === 'pro' || license.tier === 'enterprise') && license.valid;
}

/**
 * Build a human-readable upgrade message for a gated feature.
 * @param feature - The feature name to include in the message.
 * @param minTier - Optional minimum tier required (e.g. 'pro').
 */
export function upgradeMessage(feature: string, minTier?: string): string {
  const tierLabel = minTier === 'enterprise' ? 'an Enterprise plan'
    : 'a Pro Cullit plan';
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
  // Legacy aliases so old DB values still resolve
  paid: { generationsPerMonth: 500, maxProjects: 100 },
  team: { generationsPerMonth: 500, maxProjects: 100 },
  enterprise: { generationsPerMonth: Infinity, maxProjects: Infinity },
};

/**
 * Get usage limits for a license tier.
 */
export function getTierLimits(tier: string): UsageLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

/**
 * Get usage limits scaled by seat count for pro plans.
 * Seats scale limits: 100 gens/seat, 5 projects/seat (with tier base as minimum).
 */
export function getTeamLimits(seats: number): UsageLimits {
  const base = TIER_LIMITS.pro;
  if (seats <= PRO_MIN_SEATS) return base;
  return {
    generationsPerMonth: Math.max(base.generationsPerMonth, seats * 100),
    maxProjects: Math.max(base.maxProjects, seats * 5),
  };
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
  drafts:             new Set(['pro', 'enterprise']),
  approvals:          new Set(['pro', 'enterprise']),
  shared_history:     new Set(['pro', 'enterprise']),
  project_templates:  new Set(['pro', 'enterprise']),
  hosted_changelog:   new Set(['pro', 'enterprise']),
  branded_widget:     new Set(['pro', 'enterprise']),
  team_publishers:    new Set(['pro', 'enterprise']),
  org_settings:       new Set(['pro', 'enterprise']),
  audit_logs:         new Set(['pro', 'enterprise']),
  team_analytics:     new Set(['pro', 'enterprise']),
  sso:                new Set(['enterprise']),
};

/**
 * Check whether a license tier grants access to a feature.
 * Pro gets everything except SSO. Enterprise gets everything.
 */
export function isFeatureAllowed(feature: TeamFeature, tier: string, valid: boolean = true): boolean {
  if (!valid) return false;
  const allowed = FEATURE_TIERS[feature];
  return allowed ? allowed.has(tier) : false;
}

/**
 * Check whether a plan/tier grants access to a feature.
 * Enterprise gets everything. Pro gets everything except SSO.
 */
export function isPlanFeatureAllowed(feature: TeamFeature, plan: string, tier: string, valid: boolean = true): boolean {
  if (!valid) return false;
  if (tier === 'enterprise') return true;
  const tierSet = FEATURE_TIERS[feature];
  return tierSet ? tierSet.has(tier) : false;
}

/**
 * Build a gating summary for a tier — which features are unlocked.
 */
export function getFeatureGating(tier: string, plan?: string): Record<TeamFeature, boolean> {
  const result: Record<string, boolean> = {};
  for (const feature of Object.keys(FEATURE_TIERS) as TeamFeature[]) {
    result[feature] = plan
      ? isPlanFeatureAllowed(feature, plan, tier)
      : isFeatureAllowed(feature, tier);
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

  // SSRF protection: block internal addresses
  try {
    const parsed = new URL(meterUrl);
    if (isInternalHost(parsed.hostname)) return;
  } catch {
    return;
  }

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
