import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CullConfig, PublishTarget, RepoSource, TemplateProfile } from './types';

export type { AIProvider, Audience, Tone, OutputFormat, PublisherType, EnrichmentType, AIConfig, SourceConfig, PublishTarget, JiraConfig, LinearConfig, GitLabConfig, BitbucketConfig, ConfluenceConfig, NotionConfig, CullConfig, RepoSource, TemplateProfile, TemplateConfig } from './types';

const DEFAULT_CATEGORIES = ['features', 'fixes', 'breaking', 'improvements', 'chores'];

const DEFAULT_CONFIG: CullConfig = {
  ai: {
    provider: 'anthropic',
    audience: 'developer',
    tone: 'professional',
    categories: DEFAULT_CATEGORIES,
  },
  source: {
    type: 'local',
  },
  publish: [{ type: 'stdout' }],
};

/**
 * Loads config from .cullit.yml in the project root.
 * Falls back to sensible defaults.
 * Resolves environment variable references ($ENV_VAR syntax).
 */
export function loadConfig(cwdOrPath: string = process.cwd()): CullConfig {
  // Support both directory paths and direct file paths
  const configPath = cwdOrPath.endsWith('.yml') || cwdOrPath.endsWith('.yaml')
    ? cwdOrPath
    : join(cwdOrPath, '.cullit.yml');

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseSimpleYaml(raw);
  const resolved = resolveEnvVars(parsed);
  return mergeWithDefaults(resolved);
}

/**
 * Simple YAML parser for our flat-ish config structure.
 * For v1, avoids adding a yaml dependency. Handles our specific schema.
 */
function parseSimpleYaml(raw: string): Record<string, any> {
  const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];
  const safeKey = (k: string): string => {
    const trimmed = k.trim();
    if (RESERVED_KEYS.includes(trimmed)) {
      throw new Error(`Config error: reserved key "${trimmed}" is not allowed`);
    }
    return trimmed;
  };
  const result: Record<string, any> = {};
  let currentSection = '';
  let currentArray: any[] | null = null;
  let currentArrayKey = '';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    // Top-level key
    if (indent === 0 && trimmed.includes(':')) {
      const [key, ...valParts] = trimmed.split(':');
      const val = valParts.join(':').trim();
      if (val) {
        result[safeKey(key)] = parseValue(val);
      } else {
        result[safeKey(key)] = {};
        currentSection = safeKey(key);
      }
      currentArray = null;
      continue;
    }

    // Array item (- syntax)
    if (trimmed.startsWith('- ')) {
      const content = trimmed.substring(2).trim();
      if (content.includes(':') && !content.startsWith('"') && !content.startsWith("'")) {
        // Object in array
        if (currentArray === null) {
          currentArray = [];
          if (currentSection && currentArrayKey) {
            result[currentSection][currentArrayKey] = currentArray;
          } else if (currentSection) {
            result[currentSection] = currentArray;
          }
        }
        const obj: Record<string, unknown> = {};
        const [k, ...vParts] = content.split(':');
        obj[safeKey(k)] = parseValue(vParts.join(':').trim());
        currentArray.push(obj);
      } else {
        // Simple array value
        if (currentSection && currentArrayKey) {
          if (!Array.isArray(result[currentSection]?.[currentArrayKey])) {
            result[currentSection][currentArrayKey] = [];
          }
          result[currentSection][currentArrayKey].push(parseValue(content));
        } else if (currentSection) {
          if (!Array.isArray(result[currentSection])) {
            result[currentSection] = [];
          }
          result[currentSection].push(parseValue(content));
        }
      }
      continue;
    }

    // Nested key: value
    if (indent > 0 && trimmed.includes(':')) {
      const [key, ...valParts] = trimmed.split(':');
      const val = valParts.join(':').trim();
      if (val) {
        // If we're inside an array, add to the last object in the array
        if (currentArray && currentArray.length > 0) {
          const lastObj = currentArray[currentArray.length - 1];
          if (typeof lastObj === 'object') {
            lastObj[safeKey(key)] = parseValue(val);
            continue;
          }
        }
        if (currentSection) {
          result[currentSection][safeKey(key)] = parseValue(val);
        }
      } else {
        currentArrayKey = safeKey(key);
        currentArray = null;
        if (currentSection) {
          result[currentSection][currentArrayKey] = {};
        }
      }
    }
  }

  return result;
}

function parseValue(val: string): any {
  // Strip inline comments (# ...) unless inside quotes
  if (!val.startsWith('"') && !val.startsWith("'") && !val.startsWith('[')) {
    const commentIdx = val.indexOf(' #');
    if (commentIdx > 0) val = val.substring(0, commentIdx).trim();
  }
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null') return null;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  // Remove quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  // Array syntax [a, b, c]
  if (val.startsWith('[') && val.endsWith(']')) {
    return val.slice(1, -1).split(',').map(s => parseValue(s.trim()));
  }
  return val;
}

/**
 * Resolves $ENV_VAR references in config values.
 * Only allows known-safe prefixes to prevent leaking sensitive env vars.
 */
const SAFE_ENV_PREFIXES = ['CULLIT_', 'JIRA_', 'LINEAR_', 'GITHUB_', 'GITLAB_', 'BITBUCKET_', 'OPENAI_', 'ANTHROPIC_', 'GOOGLE_', 'SLACK_', 'CONFLUENCE_', 'NOTION_'];
function resolveEnvVars(obj: any): any {
  if (typeof obj === 'string') {
    // Handle both $VAR and ${VAR} syntax
    if (obj.startsWith('$')) {
      const envKey = obj.startsWith('${') && obj.endsWith('}')
        ? obj.slice(2, -1)
        : obj.substring(1);
      if (!SAFE_ENV_PREFIXES.some(p => envKey.startsWith(p))) return obj;
      return process.env[envKey] || obj;
    }
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj && typeof obj === 'object') {
    const resolved: any = {};
    for (const [k, v] of Object.entries(obj)) {
      resolved[k] = resolveEnvVars(v);
    }
    return resolved;
  }
  return obj;
}

function mergeWithDefaults(parsed: Record<string, any>): CullConfig {
  const normalizedTemplates = normalizeTemplateProfiles(parsed.templates);
  return {
    ai: {
      ...DEFAULT_CONFIG.ai,
      ...(parsed.ai || {}),
    },
    source: {
      ...DEFAULT_CONFIG.source,
      ...(parsed.source || {}),
    },
    publish: normalizePublishTargets(parsed.publish || DEFAULT_CONFIG.publish),
    template: normalizeTemplateConfig(parsed.template),
    ...(normalizedTemplates.length ? { templates: normalizedTemplates } : {}),
    jira: parsed.jira,
    linear: parsed.linear,
    gitlab: parsed.gitlab,
    bitbucket: parsed.bitbucket,
    confluence: parsed.confluence,
    notion: parsed.notion,
    ...(parsed.repos ? { repos: validateRepos(parsed.repos) } : {}),
  };
}

function validateRepos(repos: any): RepoSource[] {
  if (!Array.isArray(repos)) {
    throw new Error('Config error: "repos" must be an array');
  }
  return repos.map((repo: any, i: number) => {
    if (!repo || typeof repo !== 'object') {
      throw new Error(`Config error: repos[${i}] must be an object`);
    }
    if (!repo.url && !repo.path) {
      throw new Error(`Config error: repos[${i}] must have either "url" or "path"`);
    }
    if (repo.url && typeof repo.url !== 'string') {
      throw new Error(`Config error: repos[${i}].url must be a string`);
    }
    if (repo.path && typeof repo.path !== 'string') {
      throw new Error(`Config error: repos[${i}].path must be a string`);
    }
    return repo as RepoSource;
  });
}

/**
 * Converts snake_case YAML keys to camelCase TypeScript properties.
 * Preserves all extra keys for extensibility (e.g. spaceKey, parentPageId, databaseId).
 */
function normalizePublishTargets(targets: any[]): PublishTarget[] {
  return targets.map(t => {
    const normalized: PublishTarget = { ...t };
    // Normalize snake_case to camelCase
    if (t.webhook_url && !t.webhookUrl) {
      normalized.webhookUrl = t.webhook_url;
      delete normalized['webhook_url'];
    }
    if (t.parent_page_id && !t.parentPageId) {
      normalized.parentPageId = t.parent_page_id;
      delete normalized['parent_page_id'];
    }
    if (t.space_key && !t.spaceKey) {
      normalized.spaceKey = t.space_key;
      delete normalized['space_key'];
    }
    if (t.database_id && !t.databaseId) {
      normalized.databaseId = t.database_id;
      delete normalized['database_id'];
    }
    if (t.template_profile && !t.templateProfile) {
      normalized.templateProfile = t.template_profile;
      delete normalized['template_profile'];
    }
    if (Array.isArray(t.section_order) && !t.sectionOrder) {
      normalized.sectionOrder = t.section_order;
      delete normalized['section_order'];
    }
    return normalized;
  });
}

function normalizeTemplateConfig(template: any): CullConfig['template'] {
  if (!template || typeof template !== 'object' || Array.isArray(template)) return undefined;
  return {
    default: typeof template.default === 'string' ? template.default : undefined,
    sectionOrder: Array.isArray(template.sectionOrder)
      ? template.sectionOrder
      : Array.isArray(template.section_order)
        ? template.section_order
        : undefined,
    includeContributors: typeof template.includeContributors === 'boolean'
      ? template.includeContributors
      : typeof template.include_contributors === 'boolean'
        ? template.include_contributors
        : undefined,
    includeMetadata: typeof template.includeMetadata === 'boolean'
      ? template.includeMetadata
      : typeof template.include_metadata === 'boolean'
        ? template.include_metadata
        : undefined,
    summaryPrefix: typeof template.summaryPrefix === 'string'
      ? template.summaryPrefix
      : typeof template.summary_prefix === 'string'
        ? template.summary_prefix
        : undefined,
  };
}

function normalizeTemplateProfiles(templates: any): TemplateProfile[] {
  if (!Array.isArray(templates)) return [];
  return templates
    .filter(t => t && typeof t === 'object' && typeof t.name === 'string')
    .map(t => ({
      name: t.name,
      format: typeof t.format === 'string' ? t.format : undefined,
      sectionOrder: Array.isArray(t.sectionOrder)
        ? t.sectionOrder
        : Array.isArray(t.section_order)
          ? t.section_order
          : undefined,
      includeContributors: typeof t.includeContributors === 'boolean'
        ? t.includeContributors
        : typeof t.include_contributors === 'boolean'
          ? t.include_contributors
          : undefined,
      includeMetadata: typeof t.includeMetadata === 'boolean'
        ? t.includeMetadata
        : typeof t.include_metadata === 'boolean'
          ? t.include_metadata
          : undefined,
      summaryPrefix: typeof t.summaryPrefix === 'string'
        ? t.summaryPrefix
        : typeof t.summary_prefix === 'string'
          ? t.summary_prefix
          : undefined,
    }));
}
