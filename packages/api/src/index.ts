/**
 * Cullit API Server
 * 
 * Lightweight REST API using Node built-in http module.
 * No external dependencies — zero-overhead, production-ready.
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

import { runPipeline, VERSION, DEFAULT_CATEGORIES, AI_PROVIDERS, OUTPUT_FORMATS, getTierLimits } from '@cullit/core';
import type { CullConfig, OutputFormat, AIProvider, Audience, Tone, PublishTarget } from '@cullit/core';
import { openApiSpec } from './openapi.js';
import {
  handleAuthRedirect, handleAuthCallback, handleAuthMe, handleAuthLogout,
  resolveUser, getEffectiveTier,
} from './auth.js';
import {
  addHistoryEntry, getHistory, getHistoryCount,
  recordUsageEvent, getUsageStats, getMonthlyGenerationCount,
  type HistoryEntry,
} from './store.js';
import { migrate, closeDb, sql,
  dbGetProjectSettings, dbUpsertProjectSettings, dbListProjectSettings,
} from './db.js';
import { handleCheckout, handleBillingPortal, handleGetSubscription, handleStripeWebhook, isStripeConfigured } from './billing.js';
import { log } from './logger.js';
import {
  json, checkAuth, readBody, parseJsonObject, isRecord,
  PORT, SECURITY_HEADERS,
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
  handleCreateOrgInvite, handleListOrgInvites, handleDeleteOrgInvite,
  handleUpdateOrgMemberRole, handleGetOrgUsage,
} from './routes/org.js';

// Load pro plugins if installed
try { await import('@cullit/pro'); } catch { /* pro not installed */ }

// Run database migrations (no-op if DATABASE_URL not set)
await migrate();

// Warn at startup if Stripe is not configured so operators know billing is disabled.
if (!isStripeConfigured()) {
  log.warn(
    'Stripe is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing). ' +
    'Billing endpoints will return errors. Set these environment variables to enable payments.',
  );
}

const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS'] || '';
const IS_HTTPS = (process.env['CULLIT_BASE_URL'] || '').startsWith('https');
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
// NOTE: In-memory, per-process only. Not shared across instances.
// For multi-instance deployments, replace with Redis or similar.

const MAX_RATE_BUCKETS = 10_000;
const rateBuckets = new Map<string, number[]>();

// Prune stale rate limiter entries every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of rateBuckets) {
    const active = times.filter(t => now - t < RATE_WINDOW);
    if (active.length === 0) rateBuckets.delete(key);
    else rateBuckets.set(key, active);
  }
}, 120_000).unref();

function checkRateLimit(req: IncomingMessage, res: ServerResponse): boolean {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const timestamps = rateBuckets.get(ip) || [];
  const recent = timestamps.filter(t => now - t < RATE_WINDOW);

  // Set rate limit headers on every response
  const remaining = Math.max(0, RATE_LIMIT - recent.length);
  const resetAt = recent.length > 0 ? Math.ceil((recent[0] + RATE_WINDOW) / 1000) : Math.ceil((now + RATE_WINDOW) / 1000);
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetAt);

  if (recent.length >= RATE_LIMIT) {
    res.setHeader('Retry-After', Math.ceil(RATE_WINDOW / 1000));
    json(res, 429, { error: 'Too many requests. Try again later.' });
    return false;
  }

  // Cap total tracked IPs — evict oldest bucket to prevent memory exhaustion
  if (!rateBuckets.has(ip) && rateBuckets.size >= MAX_RATE_BUCKETS) {
    const oldestKey = rateBuckets.keys().next().value;
    if (oldestKey) rateBuckets.delete(oldestKey);
  }

  recent.push(now);
  rateBuckets.set(ip, recent);
  return true;
}

// Helpers (json, checkAuth, readBody) imported from utils.ts

// --- Pipeline result cache (LRU + TTL) ---

interface CacheEntry {
  result: unknown;
  expiresAt: number;
}

const CACHE_TTL = parseInt(process.env['CACHE_TTL'] || '300000', 10); // 5 minutes default
const MAX_CACHE_SIZE = parseInt(process.env['MAX_CACHE_SIZE'] || '100', 10);
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

// --- Routes ---

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  json(res, 200, {
    status: 'ok',
    version: VERSION,
    uptime: process.uptime(),
    database: !!sql,
    stripe: isStripeConfigured(),
  });
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
  'trial_started',
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

  if (body.plan && !['free', 'pro', 'team', 'enterprise'].includes(body.plan)) {
    json(res, 400, { error: 'Invalid plan. Must be one of: free, pro, team, enterprise' });
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

async function handleGenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: GenerateRequest;

  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!body.from) {
    json(res, 400, { error: '"from" is required (tag, SHA, or JQL/filter)' });
    return;
  }

  if (typeof body.from !== 'string' || body.from.length > 1000) {
    json(res, 400, { error: '"from" must be a string under 1000 characters' });
    return;
  }

  if (body.to !== undefined && (typeof body.to !== 'string' || body.to.length > 256)) {
    json(res, 400, { error: '"to" must be a string under 256 characters' });
    return;
  }

  const VALID_PROVIDERS = AI_PROVIDERS as readonly string[];
  if (body.provider && !VALID_PROVIDERS.includes(body.provider)) {
    json(res, 400, { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
    return;
  }

  const VALID_FORMATS = OUTPUT_FORMATS as readonly string[];
  if (body.format && !VALID_FORMATS.includes(body.format)) {
    json(res, 400, { error: `Invalid format. Must be one of: ${VALID_FORMATS.join(', ')}` });
    return;
  }

  // Build config from request body (configPath intentionally unsupported
  // in the API to prevent path traversal / arbitrary file read)
  const publishers: PublishTarget[] = [{ type: 'stdout' }];

  // Validate Jira domain if provided
  if (body.jira?.domain && !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(body.jira.domain)) {
    json(res, 400, { error: 'Invalid Jira domain format' });
    return;
  }

  const config: CullConfig = {
    ai: {
      provider: body.provider || 'anthropic',
      model: body.model,
      audience: body.audience || 'developer',
      tone: body.tone || 'professional',
      categories: body.categories || DEFAULT_CATEGORIES,
    },
    source: {
      type: body.source?.type || 'local',
      enrichment: body.source?.enrichment || [],
    },
    publish: publishers,
    ...(body.jira ? { jira: body.jira } : {}),
    ...(body.linear ? { linear: body.linear } : {}),
  };

  // Apply overrides 
  if (body.provider) config.ai.provider = body.provider;
  if (body.model) config.ai.model = body.model;

  const format = body.format || 'markdown';
  const to = body.to || 'HEAD';

  try {
    // Usage enforcement: check monthly limit before running pipeline
    const user = await resolveUser(req);
    if (!user) {
      json(res, 401, { error: 'Authentication required for generation' });
      return;
    }
    {
      const key = user.orgId || user.id;
      const monthlyCount = await getMonthlyGenerationCount(key);
      const effectiveTier = getEffectiveTier(user);
      const limits = getTierLimits(effectiveTier);
      if (monthlyCount >= limits.generationsPerMonth) {
        json(res, 402, {
          error: 'Monthly generation limit reached',
          used: monthlyCount,
          limit: limits.generationsPerMonth,
          tier: effectiveTier,
          upgrade: 'https://cullit.io/pricing',
        });
        return;
      }
    }

    // Check cache first
    const cacheKey = getCacheKey(body.from, to, format, config);
    const cached = getCachedResult(cacheKey);
    if (cached) {
      json(res, 200, cached);
      return;
    }

    const result = await runPipeline(body.from, to, config, { format, dryRun: true });

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
    json(res, 200, response);

    // Record history + analytics (fire-and-forget, don't block response)
    if (user) {
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
      addHistoryEntry(entry).catch(() => {});
      recordUsageEvent({
        userId: user.id,
        orgId: user.orgId,
        project: body.from,
        provider: config.ai.provider,
        changeCount: result.notes.changes.length,
        duration: result.duration,
        timestamp: entry.createdAt,
      }).catch(() => {});
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Pipeline error');
    json(res, 500, { error: 'Generation failed. Check server logs for details.' });
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
  const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  const entries = await getHistory(user.id, limit, offset);
  const total = await getHistoryCount(user.id);

  json(res, 200, { entries, total, limit, offset });
}

// --- Analytics Endpoint ---

async function handleGetAnalytics(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawDays = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Math.max(1, Math.min(isNaN(rawDays) ? 30 : rawDays, 90));

  // Use org-level stats if in an org, otherwise user-level
  const key = user.orgId || user.id;
  const stats = await getUsageStats(key, days);
  const monthlyCount = await getMonthlyGenerationCount(key);

  json(res, 200, {
    ...stats,
    monthlyGenerations: monthlyCount,
    tier: user.tier,
  });
}

// Draft handlers imported from routes/drafts.ts

// --- Project Settings Endpoints ---

function isTeamTier(tier: string): boolean {
  return tier === 'team' || tier === 'enterprise';
}

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

  const existing = await dbGetProjectSettings(user.id, project, user.orgId);

  const settings = await dbUpsertProjectSettings({
    id: existing?.id || randomBytes(12).toString('hex'),
    orgId: user.orgId,
    userId: user.id,
    project,
    defaultSource,
    defaultProvider,
    defaultModel,
    defaultAudience,
    defaultTone,
    categoriesJson: categories,
    publishTargetsJson: publishTargets,
    widgetConfigJson: Object.keys(widgetConfig).length ? widgetConfig : undefined,
  });

  json(res, 200, { settings });
}

// Org invite, member role, and usage handlers imported from routes/org.ts

// --- Router ---

const server = createServer(async (req, res: CorsResponse) => {
  // Resolve CORS origin for this request (stored on res to avoid cross-request races)
  res._corsOrigin = getCorsOrigin(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': res._corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
      ...SECURITY_HEADERS,
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // --- Rate limit all non-system routes ---
    if (path !== '/health' && path !== '/healthz' && path !== '/openapi.json' && path !== '/v1/billing/webhook') {
      if (!checkRateLimit(req, res)) return;
    }

    // --- Auth routes ---
    if (path === '/auth/github' && req.method === 'GET') {
      handleAuthRedirect(req, res);
    } else if (path === '/auth/callback' && req.method === 'GET') {
      await handleAuthCallback(req, res);
    } else if (path === '/auth/me' && req.method === 'GET') {
      await handleAuthMe(req, res, json);
    } else if (path === '/auth/logout' && req.method === 'POST') {
      handleAuthLogout(req, res, json);

    // --- Public / system routes ---
    } else if (path === '/health' && req.method === 'GET') {
      await handleHealth(req, res);
    } else if (path === '/healthz' && req.method === 'GET') {
      await handleHealth(req, res);
    } else if (path === '/openapi.json' && req.method === 'GET') {
      await handleOpenAPI(req, res);
    } else if (path === '/v1/events' && req.method === 'POST') {
      await handleTrackEvent(req, res);

    // --- Authenticated routes ---
    } else if ((path === '/generate' || path === '/v1/generate') && req.method === 'POST') {
      if (!checkAuth(req, res)) return;
      await handleGenerate(req, res);
    } else if (path === '/v1/changelog' && req.method === 'POST') {
      if (!checkAuth(req, res)) return;
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
      const raw = await readBody(req);
      let body: { plan?: string };
      try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return; }
      const plan = body.plan === 'team' ? 'team' : 'pro';
      await handleCheckout(user.id, plan, json, res);
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

    // --- Team / Org routes ---
    } else if (path === '/v1/org' && req.method === 'GET') {
      await handleGetOrg(req, res);
    } else if (path === '/v1/org' && req.method === 'POST') {
      await handleCreateOrg(req, res);
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
    } else if (req.method === 'PATCH' && path.match(/^\/v1\/org\/members\/[^/]+$/)) {
      const memberId = path.split('/')[4];
      await handleUpdateOrgMemberRole(req, res, memberId);
    } else if (path === '/v1/org/usage' && req.method === 'GET') {
      await handleGetOrgUsage(req, res);

    // --- History & Analytics ---
    } else if (path === '/v1/history' && req.method === 'GET') {
      await handleGetHistory(req, res);
    } else if (path === '/v1/analytics/usage' && req.method === 'GET') {
      await handleGetAnalytics(req, res);

    } else {
      json(res, 404, { error: 'Not found', docs: '/openapi.json' });
    }
  } catch (err) {
    log.error({ err }, 'Unhandled error');
    json(res, 500, { error: 'Internal server error' });
  }
});

const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.mjs');
if (isDirectRun) {
  server.listen(PORT, () => {
    log.info({ version: VERSION, port: PORT, database: !!sql, stripe: isStripeConfigured() }, `Cullit API v${VERSION} listening on http://localhost:${PORT}`);
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

export { server };
