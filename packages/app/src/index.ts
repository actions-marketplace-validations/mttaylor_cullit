/**
 * Cullit GitHub App — Webhook Server
 *
 * Verifies incoming GitHub App webhook deliveries and dispatches them
 * to per-event handlers. Logic is split across:
 *   - config.ts      env vars
 *   - util.ts        small helpers (decodeKey, base64url)
 *   - github-api.ts  GitHub REST helpers (token cache, releases, PR comments)
 *   - handlers.ts    handleRelease / handlePush / handleInstallation
 *   - metrics.ts     in-memory counters exposed at /metrics
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { VERSION, createRateLimiter } from '@cullit/core';
import { log } from './logger.js';
import { WEBHOOK_SECRET, PORT, RATE_LIMIT, RATE_WINDOW } from './config.js';
import { metrics } from './metrics.js';
import {
  handleRelease, handlePush, handleInstallation,
} from './handlers.js';

// Load pro plugins
try { await import('@cullit/pro'); } catch { /* pro not installed */ }

// --- Rate limiter (per-IP sliding window) ---
const rateLimiter = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW });

// --- Webhook delivery dedup (prevent replays) ---
const recentDeliveries = new Set<string>();
const DELIVERY_DEDUP_MAX = 10_000;

async function checkRateLimit(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const ip = req.socket.remoteAddress || 'unknown';
  const result = await rateLimiter.check(ip);
  if (!result.allowed) {
    json(res, 429, { error: 'Rate limit exceeded', retryAfterSeconds: result.retryAfterSeconds });
    return false;
  }
  return true;
}

// --- Signature Verification ---

export function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// --- HTTP helpers ---

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 5_242_880) throw new Error('Payload too large'); // 5 MB
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// --- Server ---

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { status: 'ok', app: 'cullit-github-app', version: VERSION });
    return;
  }

  if (req.method === 'GET' && req.url === '/metrics') {
    json(res, 200, { ...metrics, uptimeMs: Date.now() - metrics.startedAt });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    json(res, 404, { error: 'Not found' });
    return;
  }

  if (!(await checkRateLimit(req, res))) return;

  metrics.webhooksReceived++;

  try {
    const body = await readBody(req);

    const sig = req.headers['x-hub-signature-256'] as string;
    if (!WEBHOOK_SECRET) {
      log.error('GITHUB_WEBHOOK_SECRET is not set — rejecting all webhooks');
      json(res, 500, { error: 'Server misconfigured: webhook secret not set' });
      return;
    }
    if (!verifySignature(body, sig)) {
      json(res, 401, { error: 'Invalid signature' });
      return;
    }

    const event = req.headers['x-github-event'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;

    // Dedup deliveries
    if (deliveryId && recentDeliveries.has(deliveryId)) {
      log.debug({ deliveryId, event }, 'Duplicate webhook delivery — skipping');
      json(res, 200, { ok: true, event, duplicate: true });
      return;
    }
    if (deliveryId) {
      recentDeliveries.add(deliveryId);
      if (recentDeliveries.size > DELIVERY_DEDUP_MAX) {
        const first = recentDeliveries.values().next().value;
        if (first !== undefined) recentDeliveries.delete(first);
      }
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      json(res, 400, { error: 'Invalid JSON payload' });
      return;
    }

    // Respond immediately, process async
    json(res, 200, { ok: true, event });

    switch (event) {
      case 'release':
        handleRelease(payload as Parameters<typeof handleRelease>[0]).then(() => { metrics.releasesProcessed++; }).catch(err => {
          metrics.errors++;
          log.error({ err: err.message }, 'Release handler error');
        });
        break;
      case 'push':
        handlePush(payload as Parameters<typeof handlePush>[0]).then(() => { metrics.pushesProcessed++; }).catch(err => {
          metrics.errors++;
          log.error({ err: err.message }, 'Push handler error');
        });
        break;
      case 'installation':
      case 'installation_repositories':
        handleInstallation(payload as Parameters<typeof handleInstallation>[0]);
        break;
      default:
        log.debug({ event }, 'Ignored event');
    }
  } catch (err) {
    metrics.errors++;
    const message = (err as Error).message;
    log.error({ err: message }, 'Webhook error');
    if (message === 'Payload too large') {
      json(res, 413, { error: message });
      return;
    }
    json(res, 500, { error: 'Internal server error' });
  }
});

// Only start server when run directly (not when imported for testing)
const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.mjs');
if (isDirectRun) {
  server.listen(PORT, () => {
    log.info({ version: VERSION, port: PORT }, `Cullit GitHub App v${VERSION} listening on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    log.info('Shutting down...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export { server, handleRelease, handlePush, handleInstallation };