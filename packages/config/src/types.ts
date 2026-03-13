// ============================================
// Cullit Config Types
// ============================================

export type AIProvider = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'openclaw' | 'none';
export type Audience = 'developer' | 'end-user' | 'executive';
export type Tone = 'professional' | 'casual' | 'terse';
export type OutputFormat = 'markdown' | 'html' | 'json';
export type PublisherType = 'stdout' | 'github-release' | 'slack' | 'discord' | 'file';
export type EnrichmentType = 'jira' | 'linear';

export interface AIConfig {
  provider: AIProvider;
  model?: string;
  apiKey?: string; // resolved from env var at runtime
  audience: Audience;
  tone: Tone;
  categories: string[];
  maxTokens?: number;
}

export interface SourceConfig {
  type: 'local' | 'jira' | 'linear';
  owner?: string;
  repo?: string;
  enrichment?: EnrichmentType[];
}

export interface PublishTarget {
  type: PublisherType;
  channel?: string;     // Slack channel
  webhookUrl?: string;  // Discord/Slack webhook
  path?: string;        // File output path
}

export interface JiraConfig {
  domain: string;       // yourcompany.atlassian.net
  email?: string;
  apiToken?: string;    // resolved from env
}

export interface LinearConfig {
  apiKey?: string;      // resolved from env
}

export interface OpenClawConfig {
  baseUrl?: string;     // gateway URL, default http://localhost:18789
  token?: string;       // gateway auth token
}

export interface CullConfig {
  ai: AIConfig;
  source: SourceConfig;
  publish: PublishTarget[];
  jira?: JiraConfig;
  linear?: LinearConfig;
  openclaw?: OpenClawConfig;
}
