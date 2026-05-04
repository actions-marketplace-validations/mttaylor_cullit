/**
 * Cullit Access Model
 *
 * Cullit is now fully open source and all features are available for every tier.
 * Tier values are retained for backward compatibility with existing configs,
 * stores, and API payloads.
 */

import { fetchWithTimeout } from './fetch';

export type LicenseTier = 'free' | 'pro' | 'enterprise';

export interface LicenseStatus {
  tier: LicenseTier;
  valid: boolean;
  message?: string;
}

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

  if (!/^clt_[a-zA-Z0-9]{32,}$/.test(key)) {
    return {
      tier: 'free',
      valid: true,
      message: 'CULLIT_API_KEY format is optional in open-source mode.',
    };
  }

  return { tier: 'pro', valid: true };
}

/**
 * Backward-compatible async wrapper for prior remote license validation.
 * In open-source mode this always resolves to a valid status.
 */
export async function validateLicense(): Promise<LicenseStatus> {
  const validationUrl = process.env.CULLIT_LICENSE_URL?.trim();
  const status = resolveLicense();
  if (!validationUrl) return status;

  try {
    const parsed = new URL(validationUrl);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) {
      return {
        ...status,
        message: 'CULLIT_LICENSE_URL is optional in open-source mode and should use https if set.',
      };
    }
    if (isInternalHost(parsed.hostname)) {
      return {
        ...status,
        message: 'CULLIT_LICENSE_URL points to an internal address and will be ignored in open-source mode.',
      };
    }
  } catch {
    return {
      ...status,
      message: 'CULLIT_LICENSE_URL is optional in open-source mode and appears invalid.',
    };
  }

  return status;
}

/**
 * Check whether the current license allows the requested provider.
 * All tiers now allow AI providers (BYOK) — enforcement is via generation limits.
 */
export function isProviderAllowed(provider: string, license: LicenseStatus): boolean {
  void provider;
  void license;
  return true;
}

/**
 * Check whether the current license allows the requested publisher.
 * In open-source mode, all publishers are allowed.
 */
export function isPublisherAllowed(publisherType: string, license: LicenseStatus): boolean {
  void publisherType;
  void license;
  return true;
}

/**
 * Check whether enrichment (Jira/Linear) is available.
 * In open-source mode, enrichment is always available.
 */
export function isEnrichmentAllowed(license: LicenseStatus): boolean {
  void license;
  return true;
}

/**
 * Check whether audience and tone control are available.
 * In open-source mode, these are always available.
 */
export function isAudienceToneAllowed(license: LicenseStatus): boolean {
  void license;
  return true;
}

/**
 * Build a human-readable upgrade message for a gated feature.
 * @param feature - The feature name to include in the message.
 * @param minTier - Optional minimum tier required (e.g. 'pro').
 */
export function upgradeMessage(feature: string, minTier?: string): string {
  const label = minTier ? `${minTier} access` : 'additional access';
  return `Cullit is fully open source and ${feature} is available by default (${label}).\n` +
    'If this project helps your team, consider supporting development at https://github.com/sponsors/mttaylor.';
}

// --- Usage Metering ---

export interface UsageLimits {
  generationsPerMonth: number;
  maxProjects: number;
}

const TIER_LIMITS: Record<string, UsageLimits> = {
  free: { generationsPerMonth: Infinity, maxProjects: Infinity },
  pro: { generationsPerMonth: Infinity, maxProjects: Infinity },
  // Legacy aliases so old DB values still resolve
  paid: { generationsPerMonth: Infinity, maxProjects: Infinity },
  team: { generationsPerMonth: Infinity, maxProjects: Infinity },
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
  void seats;
  return TIER_LIMITS.pro;
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
  drafts:             new Set(['free', 'pro', 'enterprise']),
  approvals:          new Set(['free', 'pro', 'enterprise']),
  shared_history:     new Set(['free', 'pro', 'enterprise']),
  project_templates:  new Set(['free', 'pro', 'enterprise']),
  hosted_changelog:   new Set(['free', 'pro', 'enterprise']),
  branded_widget:     new Set(['free', 'pro', 'enterprise']),
  team_publishers:    new Set(['free', 'pro', 'enterprise']),
  org_settings:       new Set(['free', 'pro', 'enterprise']),
  audit_logs:         new Set(['free', 'pro', 'enterprise']),
  team_analytics:     new Set(['free', 'pro', 'enterprise']),
  sso:                new Set(['free', 'pro', 'enterprise']),
};

/**
 * Check whether a license tier grants access to a feature.
 * In open-source mode, all tiers are treated as feature-complete.
 */
export function isFeatureAllowed(feature: TeamFeature, tier: string, valid: boolean = true): boolean {
  if (!valid) return false;
  const allowed = FEATURE_TIERS[feature];
  return allowed ? allowed.has(tier) : false;
}

/**
 * Check whether a plan/tier grants access to a feature.
 * In open-source mode, all plans/tiers are treated as feature-complete.
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
