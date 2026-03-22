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
  repoPath?: string;  // Override working directory for git operations
  enrichment?: EnrichmentType[];
}

export interface PublishTarget {
  type: PublisherType;
  channel?: string;     // Slack channel
  webhookUrl?: string;  // Discord/Slack webhook
  path?: string;        // File output path
  format?: OutputFormat; // Optional per-target format override
  templateProfile?: string; // Optional named template profile override
  sectionOrder?: string[]; // Optional per-target section order override
  [key: string]: unknown; // Extensible for custom publishers
}

export interface TemplateProfile {
  name: string;
  format?: OutputFormat;
  sectionOrder?: string[];
  includeContributors?: boolean;
  includeMetadata?: boolean;
  summaryPrefix?: string;
}

export interface TemplateConfig {
  default?: string;
  sectionOrder?: string[];
  includeContributors?: boolean;
  includeMetadata?: boolean;
  summaryPrefix?: string;
}

export interface JiraConfig {
  domain: string;       // yourcompany.atlassian.net
  email?: string;
  apiToken?: string;    // resolved from env
}

export interface LinearConfig {
  apiKey?: string;      // resolved from env
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

export interface RepoSource {
  url?: string;         // git remote URL (cloned to temp dir)
  path?: string;        // local filesystem path
  name?: string;        // display name (defaults to repo basename)
  from?: string;        // override from ref for this repo
  to?: string;          // override to ref for this repo
}

export interface CullConfig {
  ai: AIConfig;
  source: SourceConfig;
  publish: PublishTarget[];
  template?: TemplateConfig;
  templates?: TemplateProfile[];
  repos?: RepoSource[];  // multi-repo aggregation
  jira?: JiraConfig;
  linear?: LinearConfig;
  gitlab?: GitLabConfig;
  bitbucket?: BitbucketConfig;
  confluence?: ConfluenceConfig;
  notion?: NotionConfig;
}
