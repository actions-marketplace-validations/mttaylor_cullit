// Shared constants across Cullit packages

export const VERSION = '2.5.0';

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
export const TIERS = ['free', 'pro', 'team', 'enterprise'] as const;
export const PAID_TIERS = ['pro', 'team', 'enterprise'] as const;
export const TEAM_TIERS = ['team', 'enterprise'] as const;

// Seat-based team pricing (single tier, dynamic seat count)
export const TEAM_SEAT_PRICE = 8;        // $8/month per seat
export const TEAM_MIN_SEATS = 5;         // minimum 5 seats
export const TEAM_ANNUAL_DISCOUNT = 0.15; // 15% annual discount
