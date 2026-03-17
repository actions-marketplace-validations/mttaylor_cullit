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
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { runPipeline, VERSION, DEFAULT_CATEGORIES, AI_PROVIDERS, OUTPUT_FORMATS } from '@cullit/core';
import type { CullConfig, OutputFormat, AIProvider, Audience, Tone, PublishTarget } from '@cullit/core';
import { openApiSpec } from './openapi.js';

// Load pro plugins if installed
try { await import('@cullit/pro'); } catch { /* pro not installed */ }

const PORT = parseInt(process.env['PORT'] || '3000', 10);
const API_TOKEN = process.env['CULLIT_API_TOKEN'] || ''; // optional bearer auth
// SECURITY: Restrict to specific origins in production.
//   ALLOWED_ORIGINS=https://yourdomain.com
const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS'] || '';
if (!ALLOWED_ORIGINS) {
  console.warn('⚠ WARNING: ALLOWED_ORIGINS is not set. CORS will reject cross-origin requests. Set ALLOWED_ORIGINS=* for local dev or specify your domain.');
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

  if (recent.length >= RATE_LIMIT) {
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

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
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

function getCacheKey(from: string, to: string, config: CullConfig): string {
  return `${from}:${to}:${config.ai.provider}:${config.ai.model || ''}:${config.ai.audience}:${config.ai.tone}:${config.source.type}`;
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
      console.log(`Loaded changelog store: ${changelogStore.size} projects`);
    }
  } catch (err) {
    console.warn('Failed to load changelog store:', (err as Error).message);
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
    console.warn('Failed to save changelog store:', (err as Error).message);
  }
}

loadChangelogStore();

// --- Routes ---

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  json(res, 200, {
    status: 'ok',
    version: VERSION,
    uptime: process.uptime(),
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
    // Check cache first
    const cacheKey = getCacheKey(body.from, to, config);
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
  } catch (err) {
    console.error('Pipeline error:', (err as Error).message);
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

// --- Router ---

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/health' && req.method === 'GET') {
      await handleHealth(req, res);
    } else if (path === '/openapi.json' && req.method === 'GET') {
      await handleOpenAPI(req, res);
    } else if (path === '/generate' && req.method === 'POST') {
      if (!checkAuth(req, res)) return;
      if (!checkRateLimit(req, res)) return;
      await handleGenerate(req, res);
    } else if (path === '/v1/changelog' && req.method === 'POST') {
      if (!checkAuth(req, res)) return;
      if (!checkRateLimit(req, res)) return;
      await handleChangelogPublish(req, res);
    } else if (req.method === 'GET' && path.match(/^\/v1\/changelog\/[^/]+\/latest$/)) {
      // Public endpoint — no auth required (CORS-enabled for widget embedding)
      if (!checkRateLimit(req, res)) return;
      const project = path.split('/')[3];
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(project)) {
        json(res, 400, { error: 'Invalid project slug' });
        return;
      }
      await handleChangelogLatest(req, res, project);
    } else {
      json(res, 404, { error: 'Not found', docs: '/openapi.json' });
    }
  } catch (err) {
    console.error('Unhandled error:', err);
    json(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║  Cullit API v${VERSION}                      ║
  ║  http://localhost:${PORT}                    ║
  ║                                           ║
  ║  GET  /health                  Status     ║
  ║  GET  /openapi.json            Spec       ║
  ║  POST /generate                Notes      ║
  ║  POST /v1/changelog            Publish    ║
  ║  GET  /v1/changelog/:p/latest  Releases   ║
  ╚═══════════════════════════════════════════╝
  `);
});
