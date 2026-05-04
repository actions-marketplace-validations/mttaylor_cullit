/**
 * System routes — health, openapi, funnel events, and changelog slug guards.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import { VERSION, TIERS } from '@cullit/core';
import { resolveUser } from '../auth.js';
import { sql } from '../db.js';
import { isStripeConfigured } from '../billing.js';
import { openApiSpec } from '../openapi.js';
import { log } from '../logger.js';
import { json, readBody } from '../utils.js';
import {
  handleChangelogLatest, handleChangelogDelete,
} from './changelog.js';

const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS'] || '';
const allowedOriginSet = new Set(ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean));

const PROJECT_SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  let dbOk = !sql;
  if (sql) { try { await sql`SELECT 1`; dbOk = true; } catch { dbOk = false; } }
  const status = dbOk ? 'ok' : 'degraded';
  json(res, dbOk ? 200 : 503, {
    status, version: VERSION,
    stripe: isStripeConfigured(),
    cors: { origins: ALLOWED_ORIGINS, count: allowedOriginSet.size },
  });
}

export async function handleOpenAPI(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  json(res, 200, openApiSpec);
}

const FUNNEL_EVENTS = new Set([
  'landing_cta_clicked', 'pricing_viewed', 'support_page_viewed',
  'checkout_started', 'checkout_redirected', 'checkout_failed',
  'paid_activated', 'first_generate_success', 'first_publish_success',
]);

export async function handleTrackEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: { event?: string; plan?: string; source?: string; metadata?: Record<string, unknown> };
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON body' }); return; }

  if (!body.event || typeof body.event !== 'string' || !FUNNEL_EVENTS.has(body.event)) {
    json(res, 400, { error: `Invalid event. Must be one of: ${Array.from(FUNNEL_EVENTS).join(', ')}` });
    return;
  }
  if (body.plan && !TIERS.includes(body.plan as typeof TIERS[number])) {
    json(res, 400, { error: `Invalid plan. Must be one of: ${TIERS.join(', ')}` }); return;
  }

  const user = await resolveUser(req);
  log.info({
    event: body.event, plan: body.plan, source: body.source, metadata: body.metadata,
    userId: user?.id, orgId: user?.orgId,
    userAgent: req.headers['user-agent'], referer: req.headers['referer'],
    timestamp: new Date().toISOString(),
  }, 'funnel_event');

  json(res, 202, { ok: true });
}

// --- Changelog wrappers (preserve inline slug validation) ---

export async function handleChangelogLatestRoute(req: IncomingMessage, res: ServerResponse, project: string): Promise<void> {
  if (!PROJECT_SLUG_RE.test(project)) { json(res, 400, { error: 'Invalid project slug' }); return; }
  await handleChangelogLatest(req, res, project);
}

export async function handleChangelogDeleteRoute(req: IncomingMessage, res: ServerResponse, project: string, version: string): Promise<void> {
  if (!PROJECT_SLUG_RE.test(project)) { json(res, 400, { error: 'Invalid project slug' }); return; }
  await handleChangelogDelete(req, res, project, decodeURIComponent(version));
}
