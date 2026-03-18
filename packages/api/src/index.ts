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
 *   POST /v1/changelog                     → Publish a release to hosted changelog
 *   GET  /v1/changelog/:project/latest     → Get latest releases (widget/page)
 * 
 * Usage:
 *   PORT=3000 node packages/api/dist/index.js
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { runPipeline, VERSION, DEFAULT_CATEGORIES, AI_PROVIDERS, OUTPUT_FORMATS, getTierLimits } from '@cullit/core';
import type { CullConfig, OutputFormat, AIProvider, Audience, Tone, PublishTarget } from '@cullit/core';
import { openApiSpec } from './openapi.js';
import {
  handleAuthRedirect, handleAuthCallback, handleAuthMe, handleAuthLogout,
  resolveUser, getUser, getOrg, createOrg, addOrgMember, removeOrgMember, getOrgMembers,
  useDb, getEffectiveTier,
} from './auth.js';
import {
  addHistoryEntry, getHistory, getHistoryCount,
  recordUsageEvent, getUsageStats, getMonthlyGenerationCount,
  type HistoryEntry,
} from './store.js';
import { migrate, dbPublishRelease, dbGetReleases, dbGetProjectCount, dbDeleteRelease, closeDb, sql,
  dbCreateDraft, dbGetDraft, dbListDrafts, dbUpdateDraft, dbUpdateDraftStatus, dbDeleteDraft,
  dbCreateRevision, dbGetRevisions, dbGetRevisionCount,
  dbGetProjectSettings, dbUpsertProjectSettings, dbListProjectSettings,
  dbCreateOrgInvite, dbListOrgInvites, dbDeleteOrgInvite, dbAcceptOrgInvite, dbGetOrgInviteByToken,
  type DraftStatus,
} from './db.js';
import { handleCheckout, handleBillingPortal, handleGetSubscription, handleStripeWebhook, isStripeConfigured } from './billing.js';
import { sendSubscriptionConfirmed, sendPaymentFailed } from './email.js';
import { log } from './logger.js';

// Load pro plugins if installed
try { await import('@cullit/pro'); } catch { /* pro not installed */ }

// Run database migrations (no-op if DATABASE_URL not set)
await migrate();

const PORT = parseInt(process.env['PORT'] || '3000', 10);
const API_TOKEN = process.env['CULLIT_API_TOKEN'] || ''; // optional bearer auth
// SECURITY: Restrict to specific origins in production.
//   ALLOWED_ORIGINS=https://yourdomain.com (comma-separated for multiple)
const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS'] || '';
if (!ALLOWED_ORIGINS) {
  log.warn('ALLOWED_ORIGINS is not set. CORS will reject cross-origin requests. Set ALLOWED_ORIGINS=* for local dev or specify your domain.');
}
const allowedOriginSet = new Set(ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean));

function getCorsOrigin(req: IncomingMessage): string {
  const origin = req.headers['origin'] || '';
  if (ALLOWED_ORIGINS === '*') return origin || '*';
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

  // Cap total tracked IPs to prevent memory exhaustion from IP rotation attacks
  if (!rateBuckets.has(ip) && rateBuckets.size >= MAX_RATE_BUCKETS) {
    json(res, 503, { error: 'Server is busy. Try again later.' });
    return false;
  }

  recent.push(now);
  rateBuckets.set(ip, recent);
  return true;
}

// --- Helpers ---

// Per-request resolved CORS origin (set at top of each request handler)
let currentCorsOrigin = '';

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': currentCorsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(payload);
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!API_TOKEN) return true; // no auth configured
  const header = req.headers['authorization'] || '';
  if (header === `Bearer ${API_TOKEN}`) return true;
  json(res, 401, { error: 'Unauthorized — set Authorization: Bearer <token>' });
  return false;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  const MAX_BODY = 1_048_576; // 1 MB

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// --- Pipeline result cache (LRU + TTL) ---

interface CacheEntry {
  result: any;
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
    openclaw: config.openclaw,
    gitlab: config.gitlab,
    bitbucket: config.bitbucket,
    confluence: config.confluence,
    notion: config.notion,
    repos: config.repos,
  });

  return createHash('sha256').update(fingerprint).digest('hex');
}

function getCachedResult(key: string): any | null {
  const entry = pipelineCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pipelineCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedResult(key: string, result: any): void {
  // LRU eviction: remove oldest entry if at capacity
  if (pipelineCache.size >= MAX_CACHE_SIZE && !pipelineCache.has(key)) {
    const oldest = pipelineCache.keys().next().value;
    if (oldest) pipelineCache.delete(oldest);
  }
  pipelineCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL });
}

// --- Changelog Store ---
// In-memory with file-backed persistence. Replace with D1/Redis/Postgres for scale.

interface ChangelogRelease {
  version: string;
  date: string;
  summary: string;
  changes: { description: string; category: string; ticketKey?: string }[];
  contributors: string[];
  metadata?: Record<string, unknown>;
  formatted: { markdown: string; html: string };
  publishedAt: string;
}

const CHANGELOG_FILE = process.env['CHANGELOG_STORE_PATH'] || './changelog-store.json';
const MAX_RELEASES_PER_PROJECT = 100;
const changelogStore = new Map<string, ChangelogRelease[]>();

// Load from disk on startup
function loadChangelogStore(): void {
  try {
    if (existsSync(CHANGELOG_FILE)) {
      const data = JSON.parse(readFileSync(CHANGELOG_FILE, 'utf-8'));
      for (const [project, releases] of Object.entries(data)) {
        if (typeof project === 'string' && Array.isArray(releases)) {
          changelogStore.set(project, releases as ChangelogRelease[]);
        }
      }
      log.info({ projects: changelogStore.size }, 'Loaded changelog store');
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Failed to load changelog store');
  }
}

function saveChangelogStore(): void {
  try {
    const data: Record<string, ChangelogRelease[]> = {};
    for (const [project, releases] of changelogStore) {
      data[project] = releases;
    }
    writeFileSync(CHANGELOG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Failed to save changelog store');
  }
}

loadChangelogStore();

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
    if (user) {
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

// --- Changelog Endpoints ---

async function handleChangelogPublish(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: any;

  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  // Validate required fields
  if (!body.project || typeof body.project !== 'string') {
    json(res, 400, { error: '"project" is required (string)' });
    return;
  }
  if (!body.version || typeof body.version !== 'string') {
    json(res, 400, { error: '"version" is required (string)' });
    return;
  }

  // Validate project slug (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(body.project)) {
    json(res, 400, { error: '"project" must be 1-64 alphanumeric characters, hyphens, or underscores' });
    return;
  }

  // Validate version format
  if (body.version.length > 64) {
    json(res, 400, { error: '"version" must be under 64 characters' });
    return;
  }

  if (!Array.isArray(body.changes)) {
    json(res, 400, { error: '"changes" must be an array' });
    return;
  }

  const release: ChangelogRelease = {
    version: body.version,
    date: /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().split('T')[0],
    summary: String(body.summary || '').slice(0, 2000),
    changes: body.changes.slice(0, 50).map((c: any) => ({
      description: String(c.description || '').slice(0, 500),
      category: String(c.category || 'chores').slice(0, 50),
      ticketKey: c.ticketKey ? String(c.ticketKey).slice(0, 32) : undefined,
    })),
    contributors: Array.isArray(body.contributors)
      ? body.contributors.slice(0, 50).map((c: any) => String(c).slice(0, 100))
      : [],
    metadata: body.metadata
      ? JSON.parse(JSON.stringify(body.metadata, (k, v) => k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v))
      : undefined,
    formatted: {
      markdown: String(body.formatted?.markdown || '').slice(0, 50_000),
      html: String(body.formatted?.html || '').slice(0, 100_000),
    },
    publishedAt: new Date().toISOString(),
  };

  // Cap total number of projects
  const MAX_PROJECTS = 1000;

  // DB-backed persistence when available
  if (useDb) {
    const projectCount = await dbGetProjectCount();
    if (projectCount >= MAX_PROJECTS) {
      json(res, 409, { error: 'Maximum number of projects reached' });
      return;
    }
    await dbPublishRelease(body.project, {
      version: release.version,
      date: release.date,
      summary: release.summary,
      changes: release.changes,
      contributors: release.contributors,
      metadata: release.metadata,
      formattedMd: release.formatted.markdown,
      formattedHtml: release.formatted.html,
    });
  } else {
    if (!changelogStore.has(body.project) && changelogStore.size >= MAX_PROJECTS) {
      json(res, 409, { error: 'Maximum number of projects reached' });
      return;
    }

    // Store the release
    const releases = changelogStore.get(body.project) || [];

    // Check for duplicate version (update if exists)
    const existingIdx = releases.findIndex(r => r.version === release.version);
    if (existingIdx >= 0) {
      releases[existingIdx] = release;
    } else {
      releases.unshift(release); // newest first
      // Cap stored releases
      if (releases.length > MAX_RELEASES_PER_PROJECT) {
        releases.length = MAX_RELEASES_PER_PROJECT;
      }
    }

    changelogStore.set(body.project, releases);
    saveChangelogStore();
  }

  json(res, 201, {
    ok: true,
    url: `https://cullit.io/changelog/${body.project}`,
    version: release.version,
    project: body.project,
  });
}

async function handleChangelogLatest(req: IncomingMessage, res: ServerResponse, project: string): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 50));

  if (useDb) {
    const result = await dbGetReleases(project, limit);
    json(res, 200, { project, releases: result });
    return;
  }

  const releases = changelogStore.get(project);
  if (!releases || releases.length === 0) {
    json(res, 200, { project, releases: [] });
    return;
  }

  // Return releases in the shape the widget expects
  const result = releases.slice(0, limit).map(r => ({
    version: r.version,
    date: r.date,
    summary: r.summary,
    changes: r.changes,
    contributors: r.contributors,
    formatted: r.formatted,
  }));

  json(res, 200, { project, releases: result });
}

async function handleChangelogDelete(req: IncomingMessage, res: ServerResponse, project: string, version: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  if (useDb) {
    const deleted = await dbDeleteRelease(project, version);
    if (!deleted) { json(res, 404, { error: 'Release not found' }); return; }
  } else {
    const releases = changelogStore.get(project);
    if (!releases) { json(res, 404, { error: 'Release not found' }); return; }
    const idx = releases.findIndex(r => r.version === version);
    if (idx < 0) { json(res, 404, { error: 'Release not found' }); return; }
    releases.splice(idx, 1);
    if (releases.length === 0) changelogStore.delete(project);
    saveChangelogStore();
  }

  json(res, 200, { ok: true, project, version });
}

async function handleChangelogListProjects(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  if (useDb) {
    const rows = await sql`SELECT DISTINCT project FROM changelog_releases ORDER BY project`;
    json(res, 200, { projects: rows.map((r: any) => r.project) });
  } else {
    json(res, 200, { projects: Array.from(changelogStore.keys()).sort() });
  }
}

// --- Team / Org Endpoints ---

async function handleGetOrg(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId) { json(res, 200, { org: null }); return; }

  const org = await getOrg(user.orgId);
  if (!org) { json(res, 200, { org: null }); return; }

  const members = (await getOrgMembers(org.id)).map(m => ({
    id: m.id, login: m.login, name: m.name, avatarUrl: m.avatarUrl, role: m.role,
  }));

  json(res, 200, {
    org: { id: org.id, name: org.name, slug: org.slug, tier: org.tier, maxSeats: org.maxSeats, memberCount: members.length, createdAt: org.createdAt },
    members,
  });
}

async function handleCreateOrg(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (user.orgId) { json(res, 409, { error: 'Already a member of an organization' }); return; }

  const raw = await readBody(req);
  let body: { name?: string };
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return; }

  if (!body.name || typeof body.name !== 'string' || body.name.length < 2 || body.name.length > 64) {
    json(res, 400, { error: '"name" is required (2-64 characters)' }); return;
  }

  const org = await createOrg(body.name, user);
  json(res, 201, { org: { id: org.id, name: org.name, slug: org.slug, tier: org.tier } });
}

async function handleOrgInvite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to invite members' }); return;
  }

  const raw = await readBody(req);
  let body: { userId?: string; role?: 'admin' | 'member' };
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return; }

  if (!body.userId || typeof body.userId !== 'string') {
    json(res, 400, { error: '"userId" is required' }); return;
  }

  const targetUser = await getUser(body.userId);
  if (!targetUser) {
    json(res, 404, { error: 'User not found' }); return;
  }

  const role = body.role === 'admin' ? 'admin' : 'member';

  // Only the org owner can grant admin role
  if (role === 'admin' && user.role !== 'owner') {
    json(res, 403, { error: 'Only the org owner can grant admin role' }); return;
  }

  const success = await addOrgMember(user.orgId, targetUser, role);
  if (!success) {
    json(res, 409, { error: 'Cannot add member (org full or already a member)' }); return;
  }

  json(res, 200, { ok: true });
}

async function handleOrgRemoveMember(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to remove members' }); return;
  }

  const raw = await readBody(req);
  let body: { userId?: string };
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return; }

  if (!body.userId || typeof body.userId !== 'string') {
    json(res, 400, { error: '"userId" is required' }); return;
  }

  const success = await removeOrgMember(user.orgId, body.userId);
  if (!success) {
    json(res, 409, { error: 'Cannot remove member (owner, not found, or not a member)' }); return;
  }

  json(res, 200, { ok: true });
}

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

// --- Draft Workflow Endpoints ---

const VALID_DRAFT_STATUSES = new Set(['draft', 'submitted', 'approved', 'published']);

async function handleCreateDraft(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  // Team feature: require team or higher tier
  const tier = getEffectiveTier(user);
  if (tier !== 'team' && tier !== 'enterprise') {
    json(res, 403, { error: 'Release drafts require a Team plan', upgrade: 'https://cullit.io/pricing' }); return;
  }

  const raw = await readBody(req);
  let body: any;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return; }

  if (!body.project || typeof body.project !== 'string') {
    json(res, 400, { error: '"project" is required' }); return;
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(body.project)) {
    json(res, 400, { error: '"project" must be 1-64 alphanumeric characters, hyphens, or underscores' }); return;
  }

  const draft = await dbCreateDraft({
    id: randomBytes(12).toString('hex'),
    orgId: user.orgId,
    userId: user.id,
    project: body.project,
    version: String(body.version || '').slice(0, 64),
    sourceType: body.sourceType || 'local',
    provider: body.provider || 'none',
    model: body.model || '',
    audience: body.audience || 'developer',
    tone: body.tone || 'professional',
    notesJson: Array.isArray(body.notes) ? body.notes.slice(0, 200) : [],
    formattedMd: String(body.formattedMd || '').slice(0, 50_000),
    formattedHtml: String(body.formattedHtml || '').slice(0, 100_000),
    rawInputsJson: body.rawInputs || null,
    createdBy: user.id,
  });

  json(res, 201, { draft });
}

async function handleListDrafts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));
  const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);
  const statusFilter = url.searchParams.get('status') || undefined;
  if (statusFilter && !VALID_DRAFT_STATUSES.has(statusFilter)) {
    json(res, 400, { error: 'Invalid status filter' }); return;
  }

  const result = await dbListDrafts({
    userId: user.id,
    orgId: user.orgId || undefined,
    status: statusFilter,
    limit,
    offset,
  });

  json(res, 200, { drafts: result.drafts, total: result.total, limit, offset });
}

async function handleGetDraft(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }

  // Access check: own draft or same org
  if (draft.user_id !== user.id && draft.org_id !== user.orgId) {
    json(res, 403, { error: 'Access denied' }); return;
  }

  const revisions = await dbGetRevisions(draftId);
  json(res, 200, { draft, revisions });
}

async function handleUpdateDraft(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }

  // Only draft owner or org admin can edit
  if (draft.user_id !== user.id && (draft.org_id !== user.orgId || user.role === 'member')) {
    json(res, 403, { error: 'Access denied' }); return;
  }

  if (draft.status === 'published') {
    json(res, 409, { error: 'Cannot edit a published draft' }); return;
  }

  const raw = await readBody(req);
  let body: any;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return; }

  // Save revision before updating
  const revisionNum = await dbGetRevisionCount(draftId);
  await dbCreateRevision({
    id: randomBytes(12).toString('hex'),
    draftId,
    revisionNumber: revisionNum + 1,
    notesJson: typeof draft.notes_json === 'string' ? JSON.parse(draft.notes_json as string) : (draft.notes_json || []),
    formattedMd: draft.formatted_md,
    formattedHtml: draft.formatted_html,
    changedBy: user.id,
  });

  const updated = await dbUpdateDraft(draftId, {
    version: body.version,
    notesJson: Array.isArray(body.notes) ? body.notes.slice(0, 200) : undefined,
    formattedMd: body.formattedMd ? String(body.formattedMd).slice(0, 50_000) : undefined,
    formattedHtml: body.formattedHtml ? String(body.formattedHtml).slice(0, 100_000) : undefined,
    audience: body.audience,
    tone: body.tone,
  });

  json(res, 200, { draft: updated });
}

async function handleDraftSubmit(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }
  if (draft.user_id !== user.id && draft.org_id !== user.orgId) {
    json(res, 403, { error: 'Access denied' }); return;
  }
  if (draft.status !== 'draft') {
    json(res, 409, { error: 'Draft must be in "draft" status to submit for review' }); return;
  }

  const updated = await dbUpdateDraftStatus(draftId, 'submitted');
  json(res, 200, { draft: updated });
}

async function handleDraftApprove(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  // Only owner or admin can approve
  if (user.role !== 'owner' && user.role !== 'admin') {
    json(res, 403, { error: 'Only org owners and admins can approve drafts' }); return;
  }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }
  if (draft.org_id !== user.orgId) {
    json(res, 403, { error: 'Access denied' }); return;
  }
  if (draft.status !== 'submitted') {
    json(res, 409, { error: 'Draft must be in "submitted" status to approve' }); return;
  }

  const updated = await dbUpdateDraftStatus(draftId, 'approved', user.id);
  json(res, 200, { draft: updated });
}

async function handleDraftPublish(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  // Only owner or admin can publish
  if (user.role !== 'owner' && user.role !== 'admin') {
    json(res, 403, { error: 'Only org owners and admins can publish drafts' }); return;
  }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }
  if (draft.org_id !== user.orgId) {
    json(res, 403, { error: 'Access denied' }); return;
  }
  if (draft.status !== 'approved') {
    json(res, 409, { error: 'Draft must be approved before publishing' }); return;
  }

  // Publish to changelog
  if (draft.version) {
    await dbPublishRelease(draft.project, {
      version: draft.version,
      date: new Date().toISOString().split('T')[0],
      summary: draft.formatted_md.slice(0, 2000),
      changes: typeof draft.notes_json === 'string' ? JSON.parse(draft.notes_json as string) : (draft.notes_json as any[]),
      contributors: [],
      formattedMd: draft.formatted_md,
      formattedHtml: draft.formatted_html,
    });
  }

  const updated = await dbUpdateDraftStatus(draftId, 'published');
  json(res, 200, { draft: updated });
}

// --- Project Settings Endpoints ---

async function handleGetProjectSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const settings = await dbListProjectSettings(user.id, user.orgId);
  json(res, 200, { settings });
}

async function handlePutProjectSettings(req: IncomingMessage, res: ServerResponse, project: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(project)) {
    json(res, 400, { error: 'Invalid project slug' }); return;
  }

  const raw = await readBody(req);
  let body: any;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return; }

  const existing = await dbGetProjectSettings(user.id, project, user.orgId);

  const settings = await dbUpsertProjectSettings({
    id: existing?.id || randomBytes(12).toString('hex'),
    orgId: user.orgId,
    userId: user.id,
    project,
    defaultSource: body.defaultSource,
    defaultProvider: body.defaultProvider,
    defaultModel: body.defaultModel,
    defaultAudience: body.defaultAudience,
    defaultTone: body.defaultTone,
    categoriesJson: Array.isArray(body.categories) ? body.categories.slice(0, 20) : undefined,
    publishTargetsJson: Array.isArray(body.publishTargets) ? body.publishTargets.slice(0, 10) : undefined,
    widgetConfigJson: body.widgetConfig || undefined,
  });

  json(res, 200, { settings });
}

// --- Org Invite Endpoints ---

async function handleCreateOrgInvite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to create invites' }); return;
  }

  const raw = await readBody(req);
  let body: { email?: string; role?: string };
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return; }

  if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
    json(res, 400, { error: 'Valid email is required' }); return;
  }

  const role = body.role === 'admin' ? 'admin' : 'member';
  if (role === 'admin' && user.role !== 'owner') {
    json(res, 403, { error: 'Only the org owner can create admin invites' }); return;
  }

  const invite = await dbCreateOrgInvite({
    id: randomBytes(12).toString('hex'),
    orgId: user.orgId,
    email: body.email.toLowerCase().trim(),
    role,
    token: randomBytes(24).toString('hex'),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    createdBy: user.id,
  });

  json(res, 201, { invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expires_at } });
}

async function handleListOrgInvites(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to list invites' }); return;
  }

  const invites = await dbListOrgInvites(user.orgId);
  json(res, 200, {
    invites: invites.map(i => ({
      id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at, createdAt: i.created_at,
    })),
  });
}

async function handleDeleteOrgInvite(req: IncomingMessage, res: ServerResponse, inviteId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to revoke invites' }); return;
  }

  const ok = await dbDeleteOrgInvite(inviteId);
  if (!ok) { json(res, 404, { error: 'Invite not found' }); return; }
  json(res, 200, { ok: true });
}

async function handleUpdateOrgMemberRole(req: IncomingMessage, res: ServerResponse, memberId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || user.role !== 'owner') {
    json(res, 403, { error: 'Only the org owner can change member roles' }); return;
  }

  const raw = await readBody(req);
  let body: { role?: string };
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return; }

  const role = body.role;
  if (role !== 'admin' && role !== 'member') {
    json(res, 400, { error: 'Role must be "admin" or "member"' }); return;
  }

  // Can't change own role
  if (memberId === user.id) {
    json(res, 409, { error: 'Cannot change your own role' }); return;
  }

  // Update the member's role via the org_members table directly
  if (useDb) {
    await sql!`UPDATE org_members SET role = ${role} WHERE org_id = ${user.orgId} AND user_id = ${memberId}`;
    await sql!`UPDATE users SET role = ${role} WHERE id = ${memberId} AND org_id = ${user.orgId}`;
  }

  json(res, 200, { ok: true, userId: memberId, role });
}

async function handleGetOrgUsage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId) { json(res, 200, { usage: null }); return; }

  const stats = await getUsageStats(user.orgId, 30);
  const monthlyCount = await getMonthlyGenerationCount(user.orgId);
  const members = await getOrgMembers(user.orgId);
  const org = await getOrg(user.orgId);
  const limits = getTierLimits(org?.tier || 'team');

  json(res, 200, {
    usage: {
      ...stats,
      monthlyGenerations: monthlyCount,
      limits,
      seats: { used: members.length, max: org?.maxSeats || 10 },
    },
  });
}

// --- Router ---

const server = createServer(async (req, res) => {
  // Resolve CORS origin for this request
  currentCorsOrigin = getCorsOrigin(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': currentCorsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // --- Rate limit all non-system routes ---
    if (path !== '/health' && path !== '/healthz' && path !== '/openapi.json' && path !== '/auth/callback' && path !== '/v1/billing/webhook') {
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
