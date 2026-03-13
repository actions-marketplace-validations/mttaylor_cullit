/**
 * Cullit License Gating
 *
 * Free tier (no key):  provider=none, publish to stdout/file only
 * Pro tier (with key): all providers, all publishers, all enrichments
 */

export type LicenseTier = 'free' | 'pro';

export interface LicenseStatus {
  tier: LicenseTier;
  valid: boolean;
  message?: string;
}

const FREE_PROVIDERS = new Set(['none']);
const FREE_PUBLISHERS = new Set(['stdout', 'file']);

/**
 * Resolve the user's license tier from CULLIT_API_KEY env var.
 * Validates the key format and caches verification result.
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
