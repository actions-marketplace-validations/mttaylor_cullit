/**
 * Server configuration: env validation, CORS resolution, client IP extraction,
 * and rate-limit enforcement. Used by the router in index.ts.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import { createRateLimiter } from '@cullit/core';
import { log } from './logger.js';
import { metrics } from './metrics.js';
import { json, ErrorCode } from './utils.js';

export const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS'] || '';
export const IS_HTTPS = (process.env['CULLIT_BASE_URL'] || '').startsWith('https');
export const IS_PROD = process.env['NODE_ENV'] === 'production';

const RATE_LIMIT = parseInt(process.env['RATE_LIMIT'] || '30', 10);
const RATE_WINDOW = 60_000;
const TRUST_PROXY = process.env['TRUST_PROXY'] === 'true';

export const allowedOriginSet = new Set(
  ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean),
);

/** Validate critical production env vars; throws on misconfiguration. */
export function assertProductionEnv(): void {
  if (!IS_PROD) {
    if (!ALLOWED_ORIGINS) {
      log.warn('ALLOWED_ORIGINS is not set. CORS will reject cross-origin requests. Set ALLOWED_ORIGINS=* for local dev or specify your domain.');
    }
    return;
  }
  if (!process.env['CULLIT_JWT_SECRET']) {
    throw new Error('CULLIT_JWT_SECRET is required in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  if (!process.env['DATABASE_URL']) {
    throw new Error('DATABASE_URL is required in production. Set a PostgreSQL connection string.');
  }
  if (!ALLOWED_ORIGINS || ALLOWED_ORIGINS === '*') {
    throw new Error('ALLOWED_ORIGINS must be set to explicit domain(s) in production (e.g. "https://cullit.io,https://www.cullit.io"). Wildcard (*) is not allowed.');
  }
  log.warn(
    'Rate limiting is in-memory (per-process). If running multiple instances, ' +
    'rate limits are NOT shared. Consider Redis-backed rate limiting for strict enforcement.',
  );
}

export function getCorsOrigin(req: IncomingMessage): string {
  const origin = req.headers['origin'] || '';
  if (ALLOWED_ORIGINS === '*') {
    if (IS_HTTPS) {
      log.warn('ALLOWED_ORIGINS=* with HTTPS is insecure — set explicit origins');
      return '';
    }
    return origin || '*';
  }
  return allowedOriginSet.has(origin) ? origin : '';
}

/** Extract real client IP — checks Cloudflare/proxy headers first when TRUST_PROXY=true. */
function getClientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp) return cfIp.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) {
      const first = xff.split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

const rateLimiter = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW });

export async function checkRateLimit(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
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
