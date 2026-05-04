/**
 * Generate route — pipeline execution, validation, caching, and per-key serialization.
 *
 * Extracted from index.ts to keep that file focused on routing/boot.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createHash, randomBytes } from 'crypto';

import {
  runPipeline, DEFAULT_CATEGORIES, AI_PROVIDERS, OUTPUT_FORMATS,
  getTierLimits, getTeamLimits,
} from '@cullit/core';
import type { CullConfig, OutputFormat, AIProvider, Audience, Tone } from '@cullit/core';

import { resolveUser, getEffectiveTier, getOrg } from '../auth.js';
import {
  addHistoryEntry, recordUsageEvent, getMonthlyGenerationCount, type HistoryEntry,
} from '../store.js';
import { log } from '../logger.js';
import { metrics } from '../metrics.js';
import { sendUsageAlert } from '../email.js';
import { json, readJsonBody, ErrorCode } from '../utils.js';

// --- Constants ---
const USAGE_ALERT_HIGH = 0.9;
const USAGE_ALERT_MEDIUM = 0.8;
const CACHE_TTL = parseInt(process.env['CACHE_TTL'] || '300000', 10) || 300_000;
const MAX_CACHE_SIZE = parseInt(process.env['MAX_CACHE_SIZE'] || '100', 10) || 100;

// --- Types ---
export interface GenerateRequest {
  from: string;
  to?: string;
  provider?: AIProvider;
  model?: string;
  audience?: Audience;
  tone?: Tone;
  format?: OutputFormat;
  categories?: string[];
  source?: {
    type?: 'local' | 'jira' | 'linear' | 'gitlab' | 'bitbucket' | 'multi-repo';
    enrichment?: ('jira' | 'linear')[];
  };
  jira?: { domain: string };
  linear?: { apiKey?: string };
}

// --- SSRF protection for user-provided domains ---
const SSRF_BLOCKED_SUFFIXES = [
  '.nip.io', '.xip.io', '.sslip.io', '.localtest.me', '.lvh.me',
  '.vcap.me', '.lacolhost.com', '.127.0.0.1.ip',
];
const SSRF_BLOCKED_EXACT = ['localtest.me', 'lvh.me', 'vcap.me', 'lacolhost.com'];
const SSRF_BLOCKED_PATTERNS = [
  /^localhost/i, /\.localhost$/i, /\.local$/i, /\.internal$/i,
  /\.svc$/i, /\.svc\./i, /\.cluster\./i, /\.pod\./i,
  /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
];

function isBlockedJiraDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(domain)) return true;
  return SSRF_BLOCKED_SUFFIXES.some(s => lower.endsWith(s))
    || SSRF_BLOCKED_EXACT.includes(lower)
    || SSRF_BLOCKED_PATTERNS.some(p => p.test(lower));
}

// --- Pipeline result cache (LRU + TTL) ---
interface CacheEntry { result: unknown; expiresAt: number; }
const pipelineCache = new Map<string, CacheEntry>();

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export function getCacheKey(from: string, to: string, format: OutputFormat, config: CullConfig, userId?: string): string {
  const fp = stableStringify({
    userId: userId || 'anon', from, to, format,
    ai: config.ai, source: config.source,
    jira: config.jira, linear: config.linear,
    gitlab: config.gitlab, bitbucket: config.bitbucket,
    confluence: config.confluence, notion: config.notion,
    repos: config.repos,
  });
  return createHash('sha256').update(fp).digest('hex');
}

function getCached(key: string): unknown | null {
  const e = pipelineCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { pipelineCache.delete(key); return null; }
  return e.result;
}

function setCached(key: string, result: unknown): void {
  if (pipelineCache.size >= MAX_CACHE_SIZE && !pipelineCache.has(key)) {
    const oldest = pipelineCache.keys().next().value;
    if (oldest) pipelineCache.delete(oldest);
  }
  pipelineCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL });
}

// --- Per-key generation mutex (prevents TOCTOU race on limit check + increment) ---
const generationLocks = new Map<string, Promise<void>>();

async function withGenerationLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (generationLocks.has(key)) await generationLocks.get(key);
  let resolve!: () => void;
  const lock = new Promise<void>(r => { resolve = r; });
  generationLocks.set(key, lock);
  try { return await fn(); }
  finally { generationLocks.delete(key); resolve(); }
}

// --- Validation ---

function validateGenerateRequest(body: GenerateRequest, res: ServerResponse): (CullConfig & { _format: OutputFormat; _to: string }) | null {
  if (!body.from) { json(res, 400, { error: '"from" is required (tag, SHA, or JQL/filter)' }); return null; }
  if (typeof body.from !== 'string' || body.from.length > 1000) {
    json(res, 400, { error: '"from" must be a string under 1000 characters' }); return null;
  }
  if (body.to !== undefined && (typeof body.to !== 'string' || body.to.length > 256)) {
    json(res, 400, { error: '"to" must be a string under 256 characters' }); return null;
  }
  if (body.provider && !(AI_PROVIDERS as readonly string[]).includes(body.provider)) {
    json(res, 400, { error: `Invalid provider. Must be one of: ${AI_PROVIDERS.join(', ')}` }); return null;
  }
  if (body.format && !(OUTPUT_FORMATS as readonly string[]).includes(body.format)) {
    json(res, 400, { error: `Invalid format. Must be one of: ${OUTPUT_FORMATS.join(', ')}` }); return null;
  }
  const sourceType = body.source?.type || 'local';
  if (sourceType === 'gitlab' || sourceType === 'bitbucket') {
    json(res, 400, { error: `Source type "${sourceType}" is not supported via the hosted API. Use the CLI instead.` }); return null;
  }
  if (body.jira?.domain && isBlockedJiraDomain(body.jira.domain)) {
    json(res, 400, { error: 'Invalid Jira domain format' }); return null;
  }

  return {
    ai: {
      provider: body.provider || 'anthropic',
      model: body.model,
      audience: body.audience || 'developer',
      tone: body.tone || 'professional',
      categories: Array.isArray(body.categories) ? body.categories.slice(0, 50) : (body.categories || DEFAULT_CATEGORIES),
    },
    source: { type: sourceType, enrichment: body.source?.enrichment || [] },
    publish: [{ type: 'stdout' }],
    ...(body.jira ? { jira: body.jira } : {}),
    ...(body.linear ? { linear: body.linear } : {}),
    _format: (body.format || 'markdown') as OutputFormat,
    _to: body.to || 'HEAD',
  };
}

function recordGeneration(
  user: { id: string; orgId: string | null },
  body: GenerateRequest,
  config: CullConfig,
  format: string,
  to: string,
  result: { notes: { changes: { length: number } }; formatted: string; duration: number },
): void {
  const entry: HistoryEntry = {
    id: randomBytes(8).toString('hex'),
    userId: user.id,
    project: body.from,
    from: body.from,
    to,
    provider: config.ai.provider,
    format,
    changeCount: result.notes.changes.length,
    summary: result.formatted.slice(0, 500),
    duration: result.duration,
    createdAt: new Date().toISOString(),
  };
  addHistoryEntry(entry).catch((err) => log.warn({ err: (err as Error).message }, 'Failed to save history entry'));
  recordUsageEvent({
    userId: user.id, orgId: user.orgId, project: body.from,
    provider: config.ai.provider,
    changeCount: result.notes.changes.length,
    duration: result.duration, timestamp: entry.createdAt,
  }).catch((err) => log.warn({ err: (err as Error).message }, 'Failed to record usage event'));
}

// --- Handler ---

export async function handleGenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) {
    json(res, 401, { error: 'Authentication required for generation', code: ErrorCode.AUTH_NOT_AUTHENTICATED });
    return;
  }

  const body = await readJsonBody(req, res) as GenerateRequest | null;
  if (!body) return;

  const validated = validateGenerateRequest(body, res);
  if (!validated) return;

  const { _format: format, _to: to, ...config } = validated;

  try {
    const key = user.orgId || user.id;
    const effectiveTier = getEffectiveTier(user);
    let limits = getTierLimits(effectiveTier);
    if (effectiveTier === 'pro' && user.orgId) {
      const org = await getOrg(user.orgId);
      if (org) limits = getTeamLimits(org.maxSeats);
    }

    // Atomic limit check
    const limitResult = await withGenerationLock(key, async () => {
      const monthlyCount = await getMonthlyGenerationCount(key);
      if (monthlyCount >= limits.generationsPerMonth) return { allowed: false as const, monthlyCount };
      return { allowed: true as const, monthlyCount };
    });

    if (!limitResult.allowed) {
      json(res, 402, {
        error: 'Monthly generation limit reached',
        code: ErrorCode.BILLING_LIMIT_REACHED,
        used: limitResult.monthlyCount, limit: limits.generationsPerMonth,
        tier: effectiveTier, support: 'https://github.com/sponsors/mttaylor',
      });
      return;
    }
    const monthlyCount = limitResult.monthlyCount;

    // Cache lookup
    const cacheKey = getCacheKey(body.from, to, format, config as CullConfig, user.orgId || user.id);
    const cached = getCached(cacheKey);
    if (cached) { json(res, 200, cached); return; }

    // Execute pipeline
    const result = await runPipeline(body.from, to, config as CullConfig, { format, dryRun: true });

    const response = {
      version: result.notes.version, date: result.notes.date,
      summary: result.notes.summary, changes: result.notes.changes,
      changeCount: result.notes.changes.length,
      contributors: result.notes.contributors,
      formatted: result.formatted, metadata: result.notes.metadata,
      duration: result.duration,
    };

    setCached(cacheKey, response);
    metrics.generation(config.ai.provider);
    json(res, 200, response);

    recordGeneration(user, body, config as CullConfig, format, to, result);

    // Usage alert thresholds (fire-and-forget)
    const newCount = monthlyCount + 1;
    const pct = newCount / limits.generationsPerMonth;
    const prevPct = monthlyCount / limits.generationsPerMonth;
    if ((pct >= USAGE_ALERT_HIGH && prevPct < USAGE_ALERT_HIGH) || (pct >= USAGE_ALERT_MEDIUM && prevPct < USAGE_ALERT_MEDIUM)) {
      sendUsageAlert(user.email, user.name || 'there', newCount, limits.generationsPerMonth)
        .catch((err) => log.warn({ err: (err as Error).message }, 'Failed to send usage alert'));
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Pipeline error');
    metrics.generationError();
    json(res, 500, { error: 'Generation failed. Check server logs for details.', code: ErrorCode.SERVER_GENERATION_FAILED });
  }
}
