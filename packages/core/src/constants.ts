// Shared constants across Cullit packages

export const VERSION = '2.10.0';

export const DEFAULT_CATEGORIES = ['features', 'fixes', 'breaking', 'improvements', 'chores'];

export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  ollama: 'auto',
};

// Well-known values for open types (extensible — plugins can register additional values)
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama', 'none'] as const;
export const OUTPUT_FORMATS = ['markdown', 'html', 'html-dark', 'html-minimal', 'html-edgy', 'json'] as const;
export const PUBLISHER_TYPES = ['stdout', 'file', 'slack', 'discord', 'github-release', 'teams', 'confluence', 'notion', 'gitlab-release', 'changelog'] as const;
export const ENRICHMENT_TYPES = ['jira', 'linear'] as const;
export const CHANGE_CATEGORIES = ['features', 'fixes', 'breaking', 'improvements', 'chores', 'other'] as const;
export const AUDIENCES = ['developer', 'end-user', 'executive'] as const;
export const TONES = ['professional', 'casual', 'terse', 'edgy', 'hype', 'snarky'] as const;
export const SOURCE_TYPES = ['local', 'jira', 'linear', 'gitlab', 'bitbucket', 'multi-repo'] as const;

// Tier names — single source of truth for subscription tiers
export const TIERS = ['free', 'pro', 'enterprise'] as const;
export const PAID_TIERS = ['pro', 'enterprise'] as const;

// Seat-based pricing ($9/seat/month, 1+ seats)
export const PRO_SEAT_PRICE = 9;            // $9/month per seat
export const PRO_MIN_SEATS = 1;             // no minimum — single-seat is fine
export const PRO_ANNUAL_DISCOUNT = 0.10;    // 10% annual discount

// Legacy aliases (remove once all consumers are migrated)
export const PAID_SEAT_PRICE = PRO_SEAT_PRICE;
export const PAID_MIN_SEATS = PRO_MIN_SEATS;
export const PAID_ANNUAL_DISCOUNT = PRO_ANNUAL_DISCOUNT;
