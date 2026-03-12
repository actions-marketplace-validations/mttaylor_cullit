// ============================================
// Cull Core Types
// ============================================

// --- Config ---

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

// --- Git Data ---

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  body?: string;
  prNumber?: number;
  issueKeys?: string[]; // PROJ-123 style keys
}

export interface GitDiff {
  from: string;
  to: string;
  commits: GitCommit[];
  filesChanged?: number;
}

// --- Enrichment ---

export interface EnrichedTicket {
  key: string;          // PROJ-123 or LIN-456
  title: string;
  description?: string;
  type?: string;        // bug, feature, task, etc.
  labels?: string[];
  priority?: string;
  status?: string;
  source: EnrichmentType;
}

export interface EnrichedContext {
  diff: GitDiff;
  tickets: EnrichedTicket[];
}

// --- Generated Output ---

export type ChangeCategory =
  | 'features'
  | 'fixes'
  | 'breaking'
  | 'improvements'
  | 'chores'
  | 'other';

export interface ChangeEntry {
  description: string;
  category: ChangeCategory;
  ticketKey?: string;
  commits?: string[];   // short hashes
}

export interface ReleaseNotes {
  version: string;
  date: string;
  summary?: string;
  changes: ChangeEntry[];
  contributors?: string[];
  metadata?: {
    commitCount: number;
    prCount: number;
    ticketCount: number;
    generatedBy: string;
    generatedAt: string;
  };
}

// --- Plugin Interfaces ---

export interface Collector {
  collect(from: string, to: string): Promise<GitDiff>;
}

export interface Enricher {
  enrich(diff: GitDiff): Promise<EnrichedTicket[]>;
}

export interface Generator {
  generate(context: EnrichedContext, config: AIConfig): Promise<ReleaseNotes>;
}

export interface Publisher {
  publish(notes: ReleaseNotes, format: OutputFormat): Promise<void>;
}

// --- Pipeline ---

export interface PipelineResult {
  notes: ReleaseNotes;
  formatted: string;
  publishedTo: string[];
  duration: number;
}
