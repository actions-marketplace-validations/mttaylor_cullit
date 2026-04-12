/**
 * Cullit API Server
 * 
 * Lightweight REST API using Node built-in http module.
 * Minimal external dependencies (pino, postgres, sanitize-html).
 * 
 * Endpoints:
 *   GET  /health                           → Health check
 *   GET  /openapi.json                     → OpenAPI 3.1 spec
 *   POST /generate                         → Generate release notes
 *   POST /v1/events                        → Funnel event tracking
 *   POST /v1/changelog                     → Publish a release to hosted changelog
 *   GET  /v1/changelog/:project/latest     → Get latest releases (widget/page)
 * 
 * Usage:
 *   PORT=3000 node packages/api/dist/index.js
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createHash, randomBytes } from 'crypto';

import { runPipeline, VERSION, DEFAULT_CATEGORIES, AI_PROVIDERS, OUTPUT_FORMATS, TIERS, getTierLimits, getTeamLimits, createRateLimiter, isPlanFeatureAllowed } from '@cullit/core';
import type { CullConfig, OutputFormat, AIProvider, Audience, Tone, PublishTarget, TeamFeature } from '@cullit/core';
import { openApiSpec } from './openapi.js';
import { handleDocs } from './docs.js';
import {
  handleAuthRedirect, handleAuthCallback, handleAuthMe, handleAuthLogout,
  handleRotateApiKey, handleDeleteAccount, handleLicenseValidate, resolveUser, getEffectiveTier,
  handleUpdateMe, getUserPlan, getOrg,
} from './auth.js';
import {
  addHistoryEntry, getHistory, getHistoryCount,
  recordUsageEvent, getUsageStats, getMonthlyGenerationCount,
  type HistoryEntry,
} from './store.js';
import { migrate, closeDb, sql,
  dbGetProjectSettings, dbUpsertProjectSettings, dbListProjectSettings,
  dbGetUserByLogin, dbGetUserByGithubUsername,
  dbRecordAuditEvent, dbGetAuditEvents,
  dbCreateProjectTemplate, dbListProjectTemplates, dbGetProjectTemplate, dbDeleteProjectTemplate,
} from './db.js';
import { handleCheckout, handleBillingPortal, handleGetSubscription, handleStripeWebhook, isStripeConfigured } from './billing.js';
import { log } from './logger.js';
import { metrics, handleMetrics } from './metrics.js';
import { sendUsageAlert } from './email.js';
import {
  json, readBody, readJsonBody, parseJsonObject, isRecord, isTeamTier, ErrorCode,
  PORT, SECURITY_HEADERS, generateRequestId, timingSafeCompare,
  type CorsResponse, type JsonObject,
} from './utils.js';

// Route modules
import { handleChangelogPublish, handleChangelogLatest, handleChangelogDelete, handleChangelogListProjects } from './routes/changelog.js';
import {
  handleCreateDraft, handleListDrafts, handleGetDraft, handleUpdateDraft,
  handleDraftSubmit, handleDeleteDraft, handleDraftApprove, handleDraftPublish,
} from './routes/drafts.js';
import {
  handleGetOrg, handleCreateOrg, handleOrgInvite, handleOrgRemoveMember,
  handleCreateOrgInvite, handleListOrgInvites, handleDeleteOrgInvite, handleAcceptOrgInvite,
  handleUpdateOrgMemberRole, handleGetOrgUsage, handleUpdateOrgSettings,
} from './routes/org.js';
import {
  handleListTeamKeys, handleUpdateTeamKey, handleSendTeamKey,
  handleRevokeTeamKey, handleRotateTeamKey,
} from './routes/team-keys.js';

// Load pro plugins if installed
try { await import('@cullit/pro'); } catch { log.info('Pro plugins not installed — running in open-core mode'); }

// Run database migrations (no-op if DATABASE_URL not set).
// Wrapped in try/catch so the server still starts if the DB is temporarily unreachable.
try { await migrate(); } catch (err) {
  log.error({ err: (err as Error).message }, 'Database migration failed — server will start in degraded mode');
}

// Warn at startup if Stripe is not configured so operators know billing is disabled.
if (!isStripeConfigured()) {
  log.warn(
    'Stripe is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing). ' +
    'Billing endpoints will return errors. Set these environment variables to enable payments.',
  );
}

const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS'] || '';
const IS_HTTPS = (process.env['CULLIT_BASE_URL'] || '').startsWith('https');

// --- Production safety checks ---
const IS_PROD = process.env['NODE_ENV'] === 'production';
if (IS_PROD) {
  if (!process.env['CULLIT_JWT_SECRET']) {
    throw new Error('CULLIT_JWT_SECRET is required in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  if (!process.env['DATABASE_URL']) {
    throw new Error('DATABASE_URL is required in production. Set a PostgreSQL connection string.');
  }
  if (!ALLOWED_ORIGINS || ALLOWED_ORIGINS === '*') {
    log.warn('ALLOWED_ORIGINS is empty or wildcard (*) in production. Set to an explicit domain for security.');
  }
  // IMPORTANT: Rate limiting is in-memory and per-process. In multi-instance
  // deployments (multiple containers/pods), each instance tracks limits independently.
  // This means the effective rate limit is multiplied by the number of instances.
  // For strict enforcement across instances, integrate a shared store like Redis.
  log.warn(
    'Rate limiting is in-memory (per-process). If running multiple instances, ' +
    'rate limits are NOT shared. Consider Redis-backed rate limiting for strict enforcement.',
  );
}

if (!ALLOWED_ORIGINS) {
  log.warn('ALLOWED_ORIGINS is not set. CORS will reject cross-origin requests. Set ALLOWED_ORIGINS=* for local dev or specify your domain.');
}

const allowedOriginSet = new Set(ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean));

function getCorsOrigin(req: IncomingMessage): string {
  const origin = req.headers['origin'] || '';
  if (ALLOWED_ORIGINS === '*') {
    // In production, wildcard + credentials is dangerous — only allow in dev
    if (IS_HTTPS) {
      log.warn('ALLOWED_ORIGINS=* with HTTPS is insecure — set explicit origins');
      return '';
    }
    return origin || '*';
  }
  return allowedOriginSet.has(origin) ? origin : '';
}
const RATE_LIMIT = parseInt(process.env['RATE_LIMIT'] || '30', 10); // requests per window
const RATE_WINDOW = 60_000; // 1 minute

// --- Rate limiter (per-IP sliding window) ---
// Automatically uses Redis backend when REDIS_URL is set.

const rateLimiter = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW });

const TRUST_PROXY = process.env['TRUST_PROXY'] === 'true'; // Explicitly opt-in to trusting proxy headers

/**
 * Extract the real client IP address from the request.
 * Checks Cloudflare/proxy headers first, falls back to socket address.
 */
function getClientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    // CF-Connecting-IP is authoritative when behind Cloudflare
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp) return cfIp.trim();

    // X-Forwarded-For: client, proxy1, proxy2 — leftmost is the real client
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) {
      const first = xff.split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

async function checkRateLimit(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const ip = getClientIp(req);
  const result = await rateLimiter.check(ip);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', result.resetAt);

  if (!result.allowed) {
    res.setHeader('Retry-After', Math.ceil(RATE_WINDOW / 1000));
    metrics.rateLimited();
    json(res, 429, { error: 'Too many requests. Try again later.', code: ErrorCode.RATE_LIMIT_EXCEEDED });
    return false;
  }

  return true;
}

// Helpers (json, readBody) imported from utils.ts

// --- Pipeline result cache (LRU + TTL) ---

interface CacheEntry {
  result: unknown;
  expiresAt: number;
}

const CACHE_TTL = parseInt(process.env['CACHE_TTL'] || '300000', 10) || 300_000; // 5 minutes default
const MAX_CACHE_SIZE = parseInt(process.env['MAX_CACHE_SIZE'] || '100', 10) || 100;
const pipelineCache = new Map<string, CacheEntry>();

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`);

  return `{${entries.join(',')}}`;
}

export function getCacheKey(from: string, to: string, format: OutputFormat, config: CullConfig): string {
  const fingerprint = stableStringify({
    from,
    to,
    format,
    ai: config.ai,
    source: config.source,
    jira: config.jira,
    linear: config.linear,
    gitlab: config.gitlab,
    bitbucket: config.bitbucket,
    confluence: config.confluence,
    notion: config.notion,
    repos: config.repos,
  });

  return createHash('sha256').update(fingerprint).digest('hex');
}

function getCachedResult(key: string): unknown | null {
  const entry = pipelineCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pipelineCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedResult(key: string, result: unknown): void {
  // LRU eviction: remove oldest entry if at capacity
  if (pipelineCache.size >= MAX_CACHE_SIZE && !pipelineCache.has(key)) {
    const oldest = pipelineCache.keys().next().value;
    if (oldest) pipelineCache.delete(oldest);
  }
  pipelineCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL });
}

// Changelog store and handlers imported from routes/changelog.ts

// --- Per-key generation mutex (prevents TOCTOU race on limit check + increment) ---
const generationLocks = new Map<string, Promise<void>>();

async function withGenerationLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any pending operation on this key to finish
  while (generationLocks.has(key)) {
    await generationLocks.get(key);
  }
  let resolve!: () => void;
  const lock = new Promise<void>(r => { resolve = r; });
  generationLocks.set(key, lock);
  try {
    return await fn();
  } finally {
    generationLocks.delete(key);
    resolve();
  }
}

// --- Routes ---

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  let dbOk = !sql; // if no DB configured, that's fine
  if (sql) {
    try { await sql`SELECT 1`; dbOk = true; } catch { dbOk = false; }
  }
  const status = dbOk ? 'ok' : 'degraded';
  json(res, dbOk ? 200 : 503, { status });
}

async function handleOpenAPI(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  json(res, 200, openApiSpec);
}

const FUNNEL_EVENTS = new Set([
  'landing_cta_clicked',
  'pricing_viewed',
  'checkout_started',
  'checkout_redirected',
  'checkout_failed',
  'paid_activated',
  'first_generate_success',
  'first_publish_success',
]);

async function handleTrackEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: { event?: string; plan?: string; source?: string; metadata?: Record<string, unknown> };

  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!body.event || typeof body.event !== 'string' || !FUNNEL_EVENTS.has(body.event)) {
    json(res, 400, {
      error: `Invalid event. Must be one of: ${Array.from(FUNNEL_EVENTS).join(', ')}`,
    });
    return;
  }

  if (body.plan && !TIERS.includes(body.plan as typeof TIERS[number])) {
    json(res, 400, { error: `Invalid plan. Must be one of: ${TIERS.join(', ')}` });
    return;
  }

  const user = await resolveUser(req);
  const userAgent = req.headers['user-agent'];
  const referer = req.headers['referer'];

  log.info({
    event: body.event,
    plan: body.plan,
    source: body.source,
    metadata: body.metadata,
    userId: user?.id,
    orgId: user?.orgId,
    userAgent,
    referer,
    timestamp: new Date().toISOString(),
  }, 'funnel_event');

  json(res, 202, { ok: true });
}

interface GenerateRequest {
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
// Only jira.domain accepts a user-provided hostname via the hosted API.
// Linear uses an API key (no URL). GitLab/Bitbucket source types are rejected above.
// Confluence/Notion/Teams publishing is CLI-only (not exposed via API).

const SSRF_BLOCKED_SUFFIXES = [
  '.nip.io', '.xip.io', '.sslip.io', '.localtest.me', '.lvh.me',
  '.vcap.me', '.lacolhost.com', '.127.0.0.1.ip',
];
const SSRF_BLOCKED_EXACT = [
  'localtest.me', 'lvh.me', 'vcap.me', 'lacolhost.com',
];
const SSRF_BLOCKED_PATTERNS = [
  /^localhost/i, /\.localhost$/i, /\.local$/i, /\.internal$/i,
  /\.svc$/i, /\.svc\./i, /\.cluster\./i, /\.pod\./i,
  /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, // IP address anywhere in hostname
];

function isBlockedJiraDomain(domain: string): boolean {
  const lowerDomain = domain.toLowerCase();
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(domain)) {
    return true;
  }
  return (
    SSRF_BLOCKED_SUFFIXES.some(s => lowerDomain.endsWith(s)) ||
    SSRF_BLOCKED_EXACT.includes(lowerDomain) ||
    SSRF_BLOCKED_PATTERNS.some(p => p.test(lowerDomain))
  );
}

// --- Generate: Validate → Execute → Record ---

function validateGenerateRequest(body: GenerateRequest, res: ServerResponse): CullConfig & { _format: OutputFormat; _to: string } | null {
  if (!body.from) {
    json(res, 400, { error: '"from" is required (tag, SHA, or JQL/filter)' });
    return null;
  }
  if (typeof body.from !== 'string' || body.from.length > 1000) {
    json(res, 400, { error: '"from" must be a string under 1000 characters' });
    return null;
  }
  if (body.to !== undefined && (typeof body.to !== 'string' || body.to.length > 256)) {
    json(res, 400, { error: '"to" must be a string under 256 characters' });
    return null;
  }

  const VALID_PROVIDERS = AI_PROVIDERS as readonly string[];
  if (body.provider && !VALID_PROVIDERS.includes(body.provider)) {
    json(res, 400, { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
    return null;
  }

  const VALID_FORMATS = OUTPUT_FORMATS as readonly string[];
  if (body.format && !VALID_FORMATS.includes(body.format)) {
    json(res, 400, { error: `Invalid format. Must be one of: ${VALID_FORMATS.join(', ')}` });
    return null;
  }

  const sourceType = body.source?.type || 'local';
  if (sourceType === 'gitlab' || sourceType === 'bitbucket') {
    json(res, 400, { error: `Source type "${sourceType}" is not supported via the hosted API. Use the CLI instead.` });
    return null;
  }

  if (body.jira?.domain && isBlockedJiraDomain(body.jira.domain)) {
    json(res, 400, { error: 'Invalid Jira domain format' });
    return null;
  }

  const config: CullConfig & { _format: OutputFormat; _to: string } = {
    ai: {
      provider: body.provider || 'anthropic',
      model: body.model,
      audience: body.audience || 'developer',
      tone: body.tone || 'professional',
      categories: body.categories || DEFAULT_CATEGORIES,
    },
    source: {
      type: sourceType,
      enrichment: body.source?.enrichment || [],
    },
    publish: [{ type: 'stdout' }],
    ...(body.jira ? { jira: body.jira } : {}),
    ...(body.linear ? { linear: body.linear } : {}),
    _format: (body.format || 'markdown') as OutputFormat,
    _to: body.to || 'HEAD',
  };

  return config;
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
  addHistoryEntry(entry).catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to save history entry'); });
  recordUsageEvent({
    userId: user.id,
    orgId: user.orgId,
    project: body.from,
    provider: config.ai.provider,
    changeCount: result.notes.changes.length,
    duration: result.duration,
    timestamp: entry.createdAt,
  }).catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to record usage event'); });
}

async function handleGenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    if (effectiveTier === 'team' && user.orgId) {
      const org = await getOrg(user.orgId);
      if (org) limits = getTeamLimits(org.maxSeats);
    }

    // Atomic limit check — serialize per key to prevent concurrent bypass
    const limitResult = await withGenerationLock(key, async () => {
      const monthlyCount = await getMonthlyGenerationCount(key);
      if (monthlyCount >= limits.generationsPerMonth) {
        return { allowed: false as const, monthlyCount };
      }
      return { allowed: true as const, monthlyCount };
    });

    if (!limitResult.allowed) {
      json(res, 402, {
        error: 'Monthly generation limit reached',
        code: ErrorCode.BILLING_LIMIT_REACHED,
        used: limitResult.monthlyCount,
        limit: limits.generationsPerMonth,
        tier: effectiveTier,
        upgrade: 'https://cullit.io/pricing',
      });
      return;
    }
    const monthlyCount = limitResult.monthlyCount;

    // Audience/tone gating — Pro+ only
    const hasCustomAudience = config.ai.audience && config.ai.audience !== 'developer';
    const hasCustomTone = config.ai.tone && config.ai.tone !== 'professional';
    if ((hasCustomAudience || hasCustomTone) && effectiveTier === 'free') {
      json(res, 403, {
        error: 'Audience and tone control requires a Pro plan or above',
        code: ErrorCode.BILLING_UPGRADE_REQUIRED,
        tier: effectiveTier,
        upgrade: 'https://cullit.io/pricing',
      });
      return;
    }

    // Check cache
    const cacheKey = getCacheKey(body.from, to, format, config as CullConfig);
    const cached = getCachedResult(cacheKey);
    if (cached) { json(res, 200, cached); return; }

    // Execute pipeline
    const result = await runPipeline(body.from, to, config as CullConfig, { format, dryRun: true });

    const response = {
      version: result.notes.version,
      date: result.notes.date,
      summary: result.notes.summary,
      changes: result.notes.changes,
      changeCount: result.notes.changes.length,
      contributors: result.notes.contributors,
      formatted: result.formatted,
      metadata: result.notes.metadata,
      duration: result.duration,
    };

    setCachedResult(cacheKey, response);
    metrics.generation(config.ai.provider);
    json(res, 200, response);

    // Record history + analytics (fire-and-forget)
    recordGeneration(user, body, config as CullConfig, format, to, result);

    // Usage alert at 80% and 90% thresholds (fire-and-forget)
    const newCount = monthlyCount + 1;
    const pct = newCount / limits.generationsPerMonth;
    const prevPct = monthlyCount / limits.generationsPerMonth;
    if ((pct >= 0.9 && prevPct < 0.9) || (pct >= 0.8 && prevPct < 0.8)) {
      sendUsageAlert(user.email, user.name || 'there', newCount, limits.generationsPerMonth)
        .catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to send usage alert'); });
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Pipeline error');
    metrics.generationError();
    json(res, 500, { error: 'Generation failed. Check server logs for details.', code: ErrorCode.SERVER_GENERATION_FAILED });
  }
}

// Changelog handlers imported from routes/changelog.ts
// Org handlers imported from routes/org.ts

// --- History Endpoint ---

async function handleGetHistory(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));

  // Support cursor-based pagination (cursor = last entry ID) or offset-based fallback
  const cursor = url.searchParams.get('cursor') || undefined;
  const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = cursor ? 0 : Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  const entries = await getHistory(user.id, limit + 1, offset, cursor);
  const hasMore = entries.length > limit;
  const page = hasMore ? entries.slice(0, limit) : entries;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : undefined;
  const total = await getHistoryCount(user.id);

  json(res, 200, { entries: page, total, limit, offset, cursor: nextCursor, hasMore });
}

// --- Analytics Endpoint ---

async function handleGetAnalytics(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  // Basic analytics require pro+ tier
  if (tier === 'free') {
    json(res, 403, { error: 'Usage analytics require a Pro plan or above', upgrade: 'https://cullit.io/pricing' }); return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawDays = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Math.max(1, Math.min(isNaN(rawDays) ? 30 : rawDays, 90));

  // Use org-level stats if in an org, otherwise user-level
  const key = user.orgId || user.id;
  const stats = await getUsageStats(key, days);
  const monthlyCount = await getMonthlyGenerationCount(key);

  // Detailed team analytics (per-member breakdown) gated to team plan+
  const plan = await getUserPlan(user);
  const hasTeamAnalytics = isPlanFeatureAllowed('team_analytics', plan, tier);

  json(res, 200, {
    ...stats,
    monthlyGenerations: monthlyCount,
    tier: user.tier,
    teamAnalytics: hasTeamAnalytics,
  });
}

// Draft handlers imported from routes/drafts.ts

// --- Project Settings Endpoints ---

async function handleGetProjectSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  if (!isTeamTier(tier)) {
    json(res, 403, { error: 'Saved project settings require a Team plan', upgrade: 'https://cullit.io/pricing' }); return;
  }

  const settings = await dbListProjectSettings(user.id, user.orgId);
  json(res, 200, { settings });
}

/** Resolve a field from body using camelCase first, then snake_case fallback. */
function pick(body: JsonObject, camel: string, snake: string): unknown {
  return body[camel] ?? body[snake];
}

/** Parse a field that can be a JSON array or a JSON string encoding an array. */
function parseArrayField(value: unknown, limit: number): string[] | undefined {
  if (Array.isArray(value)) return value.slice(0, limit);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.slice(0, limit);
    } catch { /* ignore */ }
  }
  return undefined;
}

async function handlePutProjectSettings(req: IncomingMessage, res: ServerResponse, project: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  if (!isTeamTier(tier)) {
    json(res, 403, { error: 'Saved project settings require a Team plan', upgrade: 'https://cullit.io/pricing' }); return;
  }

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(project)) {
    json(res, 400, { error: 'Invalid project slug' }); return;
  }

  const raw = await readBody(req);
  const body = parseJsonObject(raw);
  if (!body) { json(res, 400, { error: 'Invalid JSON' }); return; }

  // Resolve fields with camelCase/snake_case fallback
  const defaultSource = pick(body, 'defaultSource', 'default_source_type');
  const defaultProvider = pick(body, 'defaultProvider', 'default_provider');
  const defaultModel = pick(body, 'defaultModel', 'default_model');
  const defaultAudience = pick(body, 'defaultAudience', 'default_audience');
  const defaultTone = pick(body, 'defaultTone', 'default_tone');
  const categories = parseArrayField(pick(body, 'categories', 'categories_json'), 20);

  const publishTargetsInput = pick(body, 'publishTargets', 'publish_targets_json');
  const publishTargets = Array.isArray(publishTargetsInput) ? publishTargetsInput.slice(0, 10) : undefined;

  // Template config — resolve from nested template object or top-level body
  const templateInput = (isRecord(body.template) ? body.template : {}) as JsonObject;
  const templateDefaultFormat = pick(templateInput, 'defaultFormat', 'default_format') ?? pick(body, 'defaultFormat', 'default_format');
  const templateProfile = templateInput.profile ?? pick(templateInput, 'templateProfile', 'template_profile') ?? pick(body, 'templateProfile', 'template_profile');
  const sectionOrderInput = pick(templateInput, 'sectionOrder', 'section_order') ?? pick(body, 'sectionOrder', 'section_order');
  const templateSectionOrder = Array.isArray(sectionOrderInput)
    ? sectionOrderInput.slice(0, 20).filter((x: unknown) => typeof x === 'string')
    : undefined;

  // Build widget config with template overlay
  type WidgetConfig = { template?: { defaultFormat?: string; profile?: string; sectionOrder?: string[] } } & JsonObject;
  const widgetConfig: WidgetConfig = (isRecord(body.widgetConfig)) ? { ...body.widgetConfig } : {};
  const currentTemplate = isRecord(widgetConfig.template) ? { ...widgetConfig.template } : {};
  if (typeof templateDefaultFormat === 'string') currentTemplate.defaultFormat = templateDefaultFormat;
  if (typeof templateProfile === 'string') currentTemplate.profile = templateProfile;
  if (templateSectionOrder) currentTemplate.sectionOrder = templateSectionOrder;
  if (Object.keys(currentTemplate).length) widgetConfig.template = currentTemplate;

  // Gate branded widget: disabling branding requires team plan or enterprise
  if (widgetConfig.branding === false) {
    const plan = await getUserPlan(user);
    if (!isPlanFeatureAllowed('branded_widget', plan, tier)) {
      json(res, 403, { error: 'Branded widget (removing Cullit branding) requires a Team plan', upgrade: 'https://cullit.io/pricing' });
      return;
    }
  }

  const existing = await dbGetProjectSettings(user.id, project, user.orgId);

  const settings = await dbUpsertProjectSettings({
    id: existing?.id || randomBytes(12).toString('hex'),
    orgId: user.orgId,
    userId: user.id,
    project,
    defaultSource: defaultSource as string | undefined,
    defaultProvider: defaultProvider as string | undefined,
    defaultModel: defaultModel as string | undefined,
    defaultAudience: defaultAudience as string | undefined,
    defaultTone: defaultTone as string | undefined,
    categoriesJson: categories,
    publishTargetsJson: publishTargets,
    widgetConfigJson: Object.keys(widgetConfig).length ? widgetConfig : undefined,
  });

  json(res, 200, { settings });
}

// Org invite, member role, and usage handlers imported from routes/org.ts

// --- Audit Log Endpoint ---

async function handleGetAuditLog(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  const plan = await getUserPlan(user);
  if (!isPlanFeatureAllowed('audit_logs', plan, tier)) {
    json(res, 403, { error: 'Audit logs require a Team plan', upgrade: 'https://cullit.io/pricing' }); return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 50 : rawLimit, 100));
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  const result = await dbGetAuditEvents(user.id, limit, offset);
  json(res, 200, { events: result.events, total: result.total, limit, offset });
}

// --- Project Template Endpoints ---

async function handleListTemplates(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  const plan = await getUserPlan(user);
  if (!isPlanFeatureAllowed('project_templates', plan, tier)) {
    json(res, 403, { error: 'Project templates require a Team plan', upgrade: 'https://cullit.io/pricing' }); return;
  }
  if (!user.orgId) { json(res, 400, { error: 'Project templates require an organization' }); return; }

  const templates = await dbListProjectTemplates(user.orgId);
  json(res, 200, { templates });
}

async function handleCreateTemplate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  const plan = await getUserPlan(user);
  if (!isPlanFeatureAllowed('project_templates', plan, tier)) {
    json(res, 403, { error: 'Project templates require a Team plan', upgrade: 'https://cullit.io/pricing' }); return;
  }
  if (!user.orgId) { json(res, 400, { error: 'Project templates require an organization' }); return; }

  const raw = await readBody(req);
  const body = parseJsonObject(raw);
  if (!body) { json(res, 400, { error: 'Invalid JSON' }); return; }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name) { json(res, 400, { error: 'Template name is required' }); return; }

  const config = isRecord(body.config) ? body.config : {};
  const id = `tpl_${randomBytes(12).toString('hex')}`;

  const template = await dbCreateProjectTemplate({ id, orgId: user.orgId, name, config, createdBy: user.id });
  await dbRecordAuditEvent({ userId: user.id, action: 'template.create', target: id, metadata: { name } });
  json(res, 201, { template });
}

async function handleDeleteTemplate(req: IncomingMessage, res: ServerResponse, templateId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  const plan = await getUserPlan(user);
  if (!isPlanFeatureAllowed('project_templates', plan, tier)) {
    json(res, 403, { error: 'Project templates require a Team plan', upgrade: 'https://cullit.io/pricing' }); return;
  }
  if (!user.orgId) { json(res, 400, { error: 'Project templates require an organization' }); return; }

  if (!/^tpl_[a-f0-9]{24}$/.test(templateId)) {
    json(res, 400, { error: 'Invalid template ID' }); return;
  }

  const deleted = await dbDeleteProjectTemplate(templateId, user.orgId);
  if (!deleted) { json(res, 404, { error: 'Template not found' }); return; }

  await dbRecordAuditEvent({ userId: user.id, action: 'template.delete', target: templateId });
  json(res, 200, { ok: true });
}

// --- GitHub App Installation Linking ---

const APP_SECRET = process.env['CULLIT_APP_SECRET'] || '';

async function handleAppInstallation(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Authenticate: only the GitHub App server can call this endpoint
  const auth = req.headers['authorization'] || '';
  if (!APP_SECRET || !auth.startsWith('Bearer ') || !timingSafeCompare(auth.slice(7), APP_SECRET)) {
    json(res, 401, { error: 'Unauthorized', code: ErrorCode.AUTH_UNAUTHORIZED });
    return;
  }

  const body = await readJsonBody(req, res) as { installationId?: number; githubLogin?: string; repos?: string[] } | null;
  if (!body) return;

  if (!body.installationId || !body.githubLogin) {
    json(res, 400, { error: 'installationId and githubLogin are required' });
    return;
  }

  if (!sql) {
    json(res, 503, { error: 'Database not configured' });
    return;
  }

  // Find the Cullit user by their GitHub username (set from WorkOS GitHub OAuth identity)
  const user = await dbGetUserByGithubUsername(body.githubLogin) || await dbGetUserByLogin(body.githubLogin);
  if (!user) {
    // Store unlinked installation — will be auto-linked when the user next logs in via GitHub
    await sql`
      INSERT INTO github_installations (installation_id, user_id, github_login, repos, created_at)
      VALUES (${body.installationId}, ${null}, ${body.githubLogin}, ${JSON.stringify(body.repos || [])}, NOW())
      ON CONFLICT (installation_id) DO UPDATE SET
        github_login = EXCLUDED.github_login,
        repos = EXCLUDED.repos
    `;
    log.info({ githubLogin: body.githubLogin }, 'No Cullit user found for GitHub login — installation stored, will link on next login');
    json(res, 200, { linked: false, reason: 'User not found — will link on next login' });
    return;
  }

  // Store the installation mapping
  await sql`
    INSERT INTO github_installations (installation_id, user_id, github_login, repos, created_at)
    VALUES (${body.installationId}, ${user.id}, ${body.githubLogin}, ${JSON.stringify(body.repos || [])}, NOW())
    ON CONFLICT (installation_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      github_login = EXCLUDED.github_login,
      repos = EXCLUDED.repos
  `;

  log.info({ installationId: body.installationId, userId: user.id, githubLogin: body.githubLogin }, 'GitHub App installation linked');
  json(res, 200, { linked: true, userId: user.id });
}

// --- Router ---

const server = createServer(async (req, res: CorsResponse) => {
  // Assign a unique request ID (prefer client-supplied if valid)
  const clientId = req.headers['x-request-id'];
  res._requestId = (typeof clientId === 'string' && /^[\w-]{1,64}$/.test(clientId)) ? clientId : generateRequestId();

  // Resolve CORS origin for this request (stored on res to avoid cross-request races)
  res._corsOrigin = getCorsOrigin(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': res._corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
      'X-Request-Id': res._requestId || '',
      ...SECURITY_HEADERS,
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // --- Rate limit all non-system routes ---
    if (path !== '/health' && path !== '/healthz' && path !== '/openapi.json' && path !== '/metrics' && path !== '/v1/billing/webhook') {
      if (!(await checkRateLimit(req, res))) return;
    }

    // --- Auth routes ---
    if (path === '/auth/login' && req.method === 'GET') {
      handleAuthRedirect(req, res);
    } else if (path === '/auth/callback' && req.method === 'GET') {
      await handleAuthCallback(req, res);
    } else if (path === '/auth/me' && req.method === 'GET') {
      await handleAuthMe(req, res, json);
    } else if (path === '/auth/me' && req.method === 'PATCH') {
      await handleUpdateMe(req, res, json);
    } else if (path === '/auth/logout' && req.method === 'POST') {
      handleAuthLogout(req, res, json);
    } else if (path === '/auth/rotate-key' && req.method === 'POST') {
      await handleRotateApiKey(req, res, json);
    } else if (path === '/auth/me' && req.method === 'DELETE') {
      await handleDeleteAccount(req, res, json);

    // --- License validation ---
    } else if (path === '/v1/license/validate' && req.method === 'POST') {
      await handleLicenseValidate(req, res, json);

    // --- GitHub App internal routes ---
    } else if (path === '/v1/app/installation' && req.method === 'POST') {
      await handleAppInstallation(req, res);

    // --- Public / system routes ---
    } else if ((path === '/health' || path === '/healthz') && (req.method === 'GET' || req.method === 'HEAD')) {
      await handleHealth(req, res);
    } else if (path === '/openapi.json' && req.method === 'GET') {
      await handleOpenAPI(req, res);
    } else if ((path === '/v1/docs' || path === '/docs') && req.method === 'GET') {
      handleDocs(req, res);
    } else if (path === '/metrics' && req.method === 'GET') {
      handleMetrics(req, res);
    } else if (path === '/v1/events' && req.method === 'POST') {
      await handleTrackEvent(req, res);

    // --- Authenticated routes ---
    } else if ((path === '/generate' || path === '/v1/generate') && req.method === 'POST') {
      await handleGenerate(req, res);
    } else if (path === '/v1/changelog' && req.method === 'POST') {
      await handleChangelogPublish(req, res);
    } else if (req.method === 'GET' && path.match(/^\/v1\/changelog\/[^/]+\/latest$/)) {
      const project = path.split('/')[3];
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(project)) {
        json(res, 400, { error: 'Invalid project slug' });
        return;
      }
      await handleChangelogLatest(req, res, project);
    } else if (path === '/v1/changelog/projects' && req.method === 'GET') {
      await handleChangelogListProjects(req, res);
    } else if (req.method === 'DELETE' && path.match(/^\/v1\/changelog\/[^/]+\/[^/]+$/)) {
      const parts = path.split('/');
      const project = parts[3];
      const version = decodeURIComponent(parts[4]);
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(project)) {
        json(res, 400, { error: 'Invalid project slug' });
        return;
      }
      await handleChangelogDelete(req, res, project, version);

    // --- Billing routes ---
    } else if (path === '/v1/billing/checkout' && req.method === 'POST') {
      const user = await resolveUser(req);
      if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
      const body = await readJsonBody(req, res) as { plan?: string; annual?: boolean; seats?: number } | null;
      if (!body) return;
      const validPlans = ['pro', 'team'] as const;
      const plan = validPlans.includes(body.plan as typeof validPlans[number])
        ? (body.plan as typeof validPlans[number])
        : 'pro' as const;
      const annual = body.annual === true;
      const seats = typeof body.seats === 'number' ? body.seats : undefined;
      await handleCheckout(user.id, plan, annual, json, res, seats);
    } else if (path === '/v1/billing/portal' && req.method === 'POST') {
      const user = await resolveUser(req);
      if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
      await handleBillingPortal(user.id, json, res);
    } else if (path === '/v1/billing/subscription' && req.method === 'GET') {
      const user = await resolveUser(req);
      if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
      await handleGetSubscription(user.id, json, res);
    } else if (path === '/v1/billing/webhook' && req.method === 'POST') {
      const raw = await readBody(req);
      await handleStripeWebhook(req, raw, json, res);

    // --- GitHub App user-facing routes ---
    } else if (path === '/v1/github/installations' && req.method === 'GET') {
      const user = await resolveUser(req);
      if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
      if (!sql) { json(res, 200, { installations: [] }); return; }
      const rows = await sql`SELECT installation_id, github_login, repos, created_at FROM github_installations WHERE user_id = ${user.id}`;
      json(res, 200, { installations: rows });
    } else if (path === '/v1/github/disconnect' && req.method === 'POST') {
      const user = await resolveUser(req);
      if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
      const body = await readJsonBody(req, res) as { installationId?: number } | null;
      if (!body?.installationId) { json(res, 400, { error: 'installationId is required' }); return; }
      if (!sql) { json(res, 503, { error: 'Database not configured' }); return; }
      await sql`DELETE FROM github_installations WHERE installation_id = ${body.installationId} AND user_id = ${user.id}`;
      json(res, 200, { disconnected: true });

    // --- Team / Org routes ---
    } else if (path === '/v1/org' && req.method === 'GET') {
      await handleGetOrg(req, res);
    } else if (path === '/v1/org' && req.method === 'POST') {
      await handleCreateOrg(req, res);
    } else if (path === '/v1/org/settings' && req.method === 'PATCH') {
      await handleUpdateOrgSettings(req, res);
    } else if (path === '/v1/org/invite' && req.method === 'POST') {
      await handleOrgInvite(req, res);
    } else if (path === '/v1/org/members' && req.method === 'DELETE') {
      await handleOrgRemoveMember(req, res);

    // --- Draft workflow routes ---
    } else if (path === '/v1/drafts' && req.method === 'POST') {
      await handleCreateDraft(req, res);
    } else if (path === '/v1/drafts' && req.method === 'GET') {
      await handleListDrafts(req, res);
    } else if (req.method === 'GET' && path.match(/^\/v1\/drafts\/[^/]+$/) && !path.includes('/submit') && !path.includes('/approve') && !path.includes('/publish')) {
      const draftId = path.split('/')[3];
      await handleGetDraft(req, res, draftId);
    } else if (req.method === 'PATCH' && path.match(/^\/v1\/drafts\/[^/]+$/)) {
      const draftId = path.split('/')[3];
      await handleUpdateDraft(req, res, draftId);
    } else if (req.method === 'DELETE' && path.match(/^\/v1\/drafts\/[^/]+$/)) {
      const draftId = path.split('/')[3];
      await handleDeleteDraft(req, res, draftId);
    } else if (req.method === 'POST' && path.match(/^\/v1\/drafts\/[^/]+\/submit$/)) {
      const draftId = path.split('/')[3];
      await handleDraftSubmit(req, res, draftId);
    } else if (req.method === 'POST' && path.match(/^\/v1\/drafts\/[^/]+\/approve$/)) {
      const draftId = path.split('/')[3];
      await handleDraftApprove(req, res, draftId);
    } else if (req.method === 'POST' && path.match(/^\/v1\/drafts\/[^/]+\/publish$/)) {
      const draftId = path.split('/')[3];
      await handleDraftPublish(req, res, draftId);

    // --- Project settings routes ---
    } else if (path === '/v1/projects/settings' && req.method === 'GET') {
      await handleGetProjectSettings(req, res);
    } else if (req.method === 'PUT' && path.match(/^\/v1\/projects\/[^/]+\/settings$/)) {
      const project = path.split('/')[3];
      await handlePutProjectSettings(req, res, project);

    // --- Org invite routes ---
    } else if (path === '/v1/org/invites' && req.method === 'POST') {
      await handleCreateOrgInvite(req, res);
    } else if (path === '/v1/org/invites' && req.method === 'GET') {
      await handleListOrgInvites(req, res);
    } else if (req.method === 'DELETE' && path.match(/^\/v1\/org\/invites\/[^/]+$/)) {
      const inviteId = path.split('/')[4];
      await handleDeleteOrgInvite(req, res, inviteId);
    } else if (req.method === 'POST' && path.match(/^\/v1\/org\/invites\/[^/]+\/accept$/)) {
      const token = path.split('/')[4];
      await handleAcceptOrgInvite(req, res, token);
    } else if (req.method === 'PATCH' && path.match(/^\/v1\/org\/members\/[^/]+$/)) {
      const memberId = path.split('/')[4];
      await handleUpdateOrgMemberRole(req, res, memberId);
    } else if (path === '/v1/org/usage' && req.method === 'GET') {
      await handleGetOrgUsage(req, res);

    // --- Team API key routes ---
    } else if (path === '/v1/org/keys' && req.method === 'GET') {
      await handleListTeamKeys(req, res);
    } else if (req.method === 'PATCH' && path.match(/^\/v1\/org\/keys\/[^/]+$/)) {
      const keyId = path.split('/')[4];
      await handleUpdateTeamKey(req, res, keyId);
    } else if (req.method === 'POST' && path.match(/^\/v1\/org\/keys\/[^/]+\/send$/)) {
      const keyId = path.split('/')[4];
      await handleSendTeamKey(req, res, keyId);
    } else if (req.method === 'POST' && path.match(/^\/v1\/org\/keys\/[^/]+\/revoke$/)) {
      const keyId = path.split('/')[4];
      await handleRevokeTeamKey(req, res, keyId);
    } else if (req.method === 'POST' && path.match(/^\/v1\/org\/keys\/[^/]+\/rotate$/)) {
      const keyId = path.split('/')[4];
      await handleRotateTeamKey(req, res, keyId);

    // --- History & Analytics ---
    } else if (path === '/v1/history' && req.method === 'GET') {
      await handleGetHistory(req, res);
    } else if (path === '/v1/analytics/usage' && req.method === 'GET') {
      await handleGetAnalytics(req, res);

    // --- Audit Log ---
    } else if (path === '/v1/audit' && req.method === 'GET') {
      await handleGetAuditLog(req, res);

    // --- Project Templates ---
    } else if (path === '/v1/templates' && req.method === 'GET') {
      await handleListTemplates(req, res);
    } else if (path === '/v1/templates' && req.method === 'POST') {
      await handleCreateTemplate(req, res);
    } else if (req.method === 'DELETE' && path.match(/^\/v1\/templates\/[^/]+$/)) {
      const templateId = path.split('/')[3];
      await handleDeleteTemplate(req, res, templateId);

    } else {
      json(res, 404, { error: 'Not found', code: ErrorCode.RESOURCE_NOT_FOUND, docs: '/openapi.json' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err, requestId: res._requestId, path: req.url, method: req.method }, 'Unhandled error');
    json(res, 500, { error: 'Internal server error', code: ErrorCode.SERVER_INTERNAL_ERROR, requestId: (res as CorsResponse)._requestId });
  } finally {
    metrics.httpRequest(req.method || 'UNKNOWN', res.statusCode);
  }
});

const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.mjs');
if (isDirectRun) {
  server.headersTimeout = 30_000;    // 30s to receive headers (slow-loris protection)
  server.requestTimeout = 120_000;   // 2min total request timeout
  server.listen(PORT, '0.0.0.0', () => {
    log.info({ version: VERSION, port: PORT, database: !!sql, stripe: isStripeConfigured() }, `Cullit API v${VERSION} listening on 0.0.0.0:${PORT}`);
  });
}

// --- Graceful shutdown ---
function shutdown(signal: string) {
  log.info(`${signal} received — shutting down gracefully...`);
  server.close(async () => {
    await closeDb();
    log.info('Server closed.');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => { process.exit(1); }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception — shutting down');
  shutdown('uncaughtException');
});

export { server };
