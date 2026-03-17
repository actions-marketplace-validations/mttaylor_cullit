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

export type LicenseTier = 'free' | 'pro';

export interface LicenseStatus {
  tier: LicenseTier;
  valid: boolean;
  message?: string;
}

const FREE_PROVIDERS = new Set(['none']);
const FREE_PUBLISHERS = new Set(['stdout', 'file']);

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
        tier: data.tier === 'pro' ? 'pro' : 'free',
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
    // No cached result — fall back to format-only (offline-friendly, first run)
    return { tier: 'pro', valid: true, message: 'Offline validation — using cached license.' };
  }
}

/**
 * Check whether the current license allows the requested provider.
 */
export function isProviderAllowed(provider: string, license: LicenseStatus): boolean {
  if (license.tier === 'pro' && license.valid) return true;
  return FREE_PROVIDERS.has(provider);
}

/**
 * Check whether the current license allows the requested publisher.
 */
export function isPublisherAllowed(publisherType: string, license: LicenseStatus): boolean {
  if (license.tier === 'pro' && license.valid) return true;
  return FREE_PUBLISHERS.has(publisherType);
}

/**
 * Check whether the current license allows enrichment (Jira/Linear).
 */
export function isEnrichmentAllowed(license: LicenseStatus): boolean {
  return license.tier === 'pro' && license.valid;
}

/**
 * Build a human-readable upgrade message for a gated feature.
 */
export function upgradeMessage(feature: string): string {
  return `🔒 ${feature} requires a Cullit Pro license.\n` +
         `   Get your API key at https://cullit.io/pricing\n` +
         `   Then set CULLIT_API_KEY in your environment.`;
}

// --- Usage Metering ---

export interface UsageLimits {
  generationsPerMonth: number;
  maxProjects: number;
}

const TIER_LIMITS: Record<string, UsageLimits> = {
  free: { generationsPerMonth: 3, maxProjects: 1 },
  pro: { generationsPerMonth: 500, maxProjects: 5 },
  team: { generationsPerMonth: 2000, maxProjects: 25 },
  enterprise: { generationsPerMonth: Infinity, maxProjects: Infinity },
};

/**
 * Get usage limits for a license tier.
 */
export function getTierLimits(tier: string): UsageLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
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
