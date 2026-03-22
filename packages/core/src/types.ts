// ============================================
// Cullit Core Types
// ============================================

// --- Config (re-exported from @cullit/config) ---

export type {
  AIProvider,
  Audience,
  Tone,
  OutputFormat,
  PublisherType,
  EnrichmentType,
  AIConfig,
  SourceConfig,
  PublishTarget,
  JiraConfig,
  LinearConfig,

  GitLabConfig,
  BitbucketConfig,
  ConfluenceConfig,
  NotionConfig,
  TemplateProfile,
  TemplateConfig,
  RepoSource,
  CullConfig,
} from '@cullit/config';

import type { EnrichmentType, OutputFormat, AIConfig } from '@cullit/config';

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

// Open type — well-known values in constants.ts
export type ChangeCategory = string;

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
  publish(notes: ReleaseNotes, format: OutputFormat, preformatted?: string): Promise<void>;
}

// --- Pipeline ---

export interface PipelineResult {
  notes: ReleaseNotes;
  formatted: string;
  publishedTo: string[];
  duration: number;
}
