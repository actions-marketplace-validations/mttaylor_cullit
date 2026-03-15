// ============================================
// Cullit Config Types
// ============================================

// Open type system — use string for extensibility, well-known values in constants
export type AIProvider = string;
export type Audience = string;
export type Tone = string;
export type OutputFormat = string;
export type PublisherType = string;
export type EnrichmentType = string;

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
  type: string;
  owner?: string;
  repo?: string;
  enrichment?: EnrichmentType[];
}

export interface PublishTarget {
  type: PublisherType;
  channel?: string;     // Slack channel
  webhookUrl?: string;  // Discord/Slack webhook
  path?: string;        // File output path
  [key: string]: unknown; // Extensible for custom publishers
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

export interface GitLabConfig {
  domain?: string;      // default: gitlab.com
  projectId: string;    // numeric ID or URL-encoded path
}

export interface BitbucketConfig {
  workspace: string;    // Bitbucket workspace
  repoSlug: string;     // repository slug
}

export interface ConfluenceConfig {
  domain: string;       // yourcompany.atlassian.net
  spaceKey: string;     // Confluence space key
  parentPageId?: string; // optional: parent page to nest under
}

export interface NotionConfig {
  databaseId: string;   // Notion database ID
}

export interface CullConfig {
  ai: AIConfig;
  source: SourceConfig;
  publish: PublishTarget[];
  jira?: JiraConfig;
  linear?: LinearConfig;
  openclaw?: OpenClawConfig;
  gitlab?: GitLabConfig;
  bitbucket?: BitbucketConfig;
  confluence?: ConfluenceConfig;
  notion?: NotionConfig;
}
