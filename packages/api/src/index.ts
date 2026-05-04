/**
 * Cullit API Server
 *
 * Lightweight REST API on Node's built-in http module. The routing table,
 * handler implementations, server config, and rate limiting all live in
 * dedicated modules; this file owns startup, the request loop, and shutdown.
 *
 * Endpoints: see ./routes/index.ts and openapi.json.
 *
 * Usage:
 *   PORT=3000 node packages/api/dist/index.js
 */
import { createServer } from 'http';

import { VERSION } from '@cullit/core';
import { migrate, closeDb, sql, dbRunRetentionCleanup } from './db.js';
import { isStripeConfigured } from './billing.js';
import { log } from './logger.js';
import { metrics } from './metrics.js';
import { json, ErrorCode, PORT, SECURITY_HEADERS, generateRequestId, type CorsResponse } from './utils.js';
import {
  ALLOWED_ORIGINS, IS_HTTPS, allowedOriginSet,
  assertProductionEnv, getCorsOrigin, checkRateLimit,
} from './server-config.js';
import { routes } from './routes/index.js';

// Re-exported for tests that import directly from the entrypoint.
export { getCacheKey } from './routes/generate.js';

// Load pro plugins if installed
try { await import('@cullit/pro'); } catch { log.info('Optional plugin package not installed — running with core OSS modules only'); }

// Production env validation (throws on misconfig); also warns about CORS in dev.
assertProductionEnv();

// Run database migrations (no-op if DATABASE_URL not set).
// Wrapped in try/catch so the server still starts if the DB is temporarily unreachable.
try { await migrate(); } catch (err) {
  log.error({ err: (err as Error).message }, 'Database migration failed — server will start in degraded mode');
}

// Schedule daily data-retention cleanup (90d generations, 365d audit events) per PRIVACY.md.
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const retentionTimer = setTimeout(() => {
  dbRunRetentionCleanup().catch((err) => log.error({ err: (err as Error).message }, 'Retention cleanup failed'));
  setInterval(() => {
    dbRunRetentionCleanup().catch((err) => log.error({ err: (err as Error).message }, 'Retention cleanup failed'));
  }, RETENTION_INTERVAL_MS).unref();
}, 60_000);
retentionTimer.unref();

if (!isStripeConfigured()) {
  log.info('Stripe is not configured. Billing endpoints are retained only for legacy compatibility responses.');
}

// --- Router ---

const server = createServer(async (req, res: CorsResponse) => {
  // Assign a unique request ID (prefer client-supplied if valid)
  const clientId = req.headers['x-request-id'];
  res._requestId = (typeof clientId === 'string' && /^[\w-]{1,64}$/.test(clientId)) ? clientId : generateRequestId();

  // Resolve CORS origin for this request (stored on res to avoid cross-request races)
  res._corsOrigin = getCorsOrigin(req);
  if (res._corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', res._corsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': res._corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
      'X-Request-Id': res._requestId || '',
      ...SECURITY_HEADERS,
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    for (const route of routes) {
      if (req.method !== route.method) continue;

      if (typeof route.path === 'string') {
        if (path !== route.path) continue;
        if (route.rateLimit !== false && !(await checkRateLimit(req, res))) return;
        await route.handler(req, res);
        return;
      }

      const match = path.match(route.path);
      if (!match) continue;
      if (route.rateLimit !== false && !(await checkRateLimit(req, res))) return;
      await route.handler(req, res, ...match.slice(1));
      return;
    }

    json(res, 404, { error: 'Not found', code: ErrorCode.RESOURCE_NOT_FOUND, docs: '/openapi.json' });
  } catch (err) {
    log.error({ err, requestId: res._requestId, path: req.url, method: req.method }, 'Unhandled error');
    try {
      if (!res.headersSent) {
        json(res, 500, { error: 'Internal server error', code: ErrorCode.SERVER_INTERNAL_ERROR, requestId: res._requestId });
      } else if (!res.writableEnded) {
        res.end();
      }
    } catch (writeErr) {
      log.error({ writeErr, requestId: res._requestId }, 'Failed to send error response');
    }
  } finally {
    metrics.httpRequest(req.method || 'UNKNOWN', res.statusCode);
  }
});

// --- Boot ---

const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.mjs');
if (isDirectRun) {
  server.headersTimeout = 30_000;    // slow-loris protection
  server.requestTimeout = 120_000;
  server.listen(PORT, '0.0.0.0', () => {
    log.info({
      version: VERSION,
      port: PORT,
      database: !!sql,
      stripe: isStripeConfigured(),
      allowedOrigins: ALLOWED_ORIGINS,
      corsOriginCount: allowedOriginSet.size,
      isHttps: IS_HTTPS,
    }, `Cullit API v${VERSION} listening on 0.0.0.0:${PORT}`);
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
