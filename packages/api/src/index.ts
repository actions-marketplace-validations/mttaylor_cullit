/**
 * Cullit API Server
 * 
 * Lightweight REST API using Node built-in http module.
 * No external dependencies — zero-overhead, production-ready.
 * 
 * Endpoints:
 *   GET  /health         → Health check
 *   GET  /openapi.json   → OpenAPI 3.1 spec
 *   POST /generate       → Generate release notes
 * 
 * Usage:
 *   PORT=3000 node packages/api/dist/index.js
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { runPipeline, VERSION, DEFAULT_CATEGORIES } from '@cullit/core';
import type { CullConfig, OutputFormat, AIProvider, Audience, Tone, PublishTarget } from '@cullit/core';
import { openApiSpec } from './openapi.js';

const PORT = parseInt(process.env['PORT'] || '3000', 10);
const API_TOKEN = process.env['CULLIT_API_TOKEN'] || ''; // optional bearer auth
// SECURITY: Defaults to '*' for local dev. In production, restrict to specific origins:
//   ALLOWED_ORIGINS=https://yourdomain.com
const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS'] || '*';
const RATE_LIMIT = parseInt(process.env['RATE_LIMIT'] || '30', 10); // requests per window
const RATE_WINDOW = 60_000; // 1 minute

// --- Rate limiter (per-IP sliding window) ---

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
    type?: 'local' | 'jira' | 'linear';
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

  const VALID_PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama', 'openclaw', 'none'];
  if (body.provider && !VALID_PROVIDERS.includes(body.provider)) {
    json(res, 400, { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
    return;
  }

  const VALID_FORMATS = ['markdown', 'html', 'json'];
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
    const result = await runPipeline(body.from, to, config, { format, dryRun: true });

    json(res, 200, {
      version: result.notes.version,
      date: result.notes.date,
      summary: result.notes.summary,
      changes: result.notes.changes,
      changeCount: result.notes.changes.length,
      contributors: result.notes.contributors,
      formatted: result.formatted,
      metadata: result.notes.metadata,
      duration: result.duration,
    });
  } catch (err) {
    console.error('Pipeline error:', (err as Error).message);
    json(res, 500, { error: 'Generation failed. Check server logs for details.' });
  }
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
  ║  GET  /health         Health check        ║
  ║  GET  /openapi.json   OpenAPI spec        ║
  ║  POST /generate       Generate notes      ║
  ╚═══════════════════════════════════════════╝
  `);
});
