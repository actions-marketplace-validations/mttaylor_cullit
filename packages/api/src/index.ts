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
import { runPipeline } from '@cull/core';
import { loadConfig } from '@cull/config';
import type { CullConfig, OutputFormat, AIProvider, Audience, Tone, PublishTarget } from '@cull/core';
import { openApiSpec } from './openapi.js';

const PORT = parseInt(process.env['PORT'] || '3000', 10);
const API_TOKEN = process.env['CULLIT_API_TOKEN'] || ''; // optional bearer auth
const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS'] || '*';

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
    version: '0.1.0',
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
  configPath?: string;
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

  // Build config from request body or load from file
  let config: CullConfig;

  if (body.configPath) {
    try {
      config = loadConfig(body.configPath);
    } catch (err) {
      json(res, 400, { error: `Config load failed: ${(err as Error).message}` });
      return;
    }
  } else {
    const publishers: PublishTarget[] = [{ type: 'stdout' }];

    config = {
      ai: {
        provider: body.provider || 'anthropic',
        model: body.model,
        audience: body.audience || 'developer',
        tone: body.tone || 'professional',
        categories: body.categories || ['features', 'fixes', 'breaking', 'improvements', 'chores'],
      },
      source: {
        type: body.source?.type || 'local',
        enrichment: body.source?.enrichment || [],
      },
      publish: publishers,
      ...(body.jira ? { jira: body.jira } : {}),
      ...(body.linear ? { linear: body.linear } : {}),
    };
  }

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
  ║  Cullit API v0.1.0                      ║
  ║  http://localhost:${PORT}                    ║
  ║                                           ║
  ║  GET  /health         Health check        ║
  ║  GET  /openapi.json   OpenAPI spec        ║
  ║  POST /generate       Generate notes      ║
  ╚═══════════════════════════════════════════╝
  `);
});
