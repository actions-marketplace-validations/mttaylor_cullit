// Shared constants across Cullit packages

export const VERSION = '2.3.0';

export const DEFAULT_CATEGORIES = ['features', 'fixes', 'breaking', 'improvements', 'chores'];

export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  ollama: 'llama3.2:3b',
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

// Seat-based team plans
export const TEAM_PLANS = ['team-5', 'team-10', 'team-25'] as const;
export type TeamPlan = (typeof TEAM_PLANS)[number];
export const TEAM_PLAN_SEATS: Record<TeamPlan, number> = {
  'team-5': 5,
  'team-10': 10,
  'team-25': 25,
};
