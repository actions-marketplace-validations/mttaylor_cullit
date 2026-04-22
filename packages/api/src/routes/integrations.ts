/**
 * POST /v1/integrations/test  — probe one or more integrations and return per-integration status.
 *
 * Auth: requires a logged-in user (resolveUser). Does NOT publish anything.
 *
 * Body (all optional):
 *   { only?: string[], config?: Partial<CullConfig> }
 *
 * If `config` is omitted, we build a probe config from the request env (env vars on the API host),
 * which lets the dashboard verify env-side credentials (GITHUB_TOKEN, JIRA_*, etc.) for the user.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { json, readBody, parseJsonObject } from '../utils.js';
import { resolveUser } from '../auth.js';
import { verifyIntegrations } from '@cullit/core';
import type { CullConfig, PublishTarget } from '@cullit/core';
import { log } from '../logger.js';

export async function handleIntegrationsTest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  let body: Record<string, unknown> = {};
  try {
    const raw = await readBody(req);
    if (raw) body = parseJsonObject(raw) || {};
  } catch {
    json(res, 400, { error: 'Invalid JSON' });
    return;
  }

  const only = Array.isArray(body.only) ? (body.only as unknown[]).filter((s): s is string => typeof s === 'string') : undefined;

  // Build a probe config from the body, falling back to a minimal one.
  const reqConfig = (body.config && typeof body.config === 'object') ? body.config as Partial<CullConfig> : {};
  const config: CullConfig = {
    source: reqConfig.source || 'local',
    publish: Array.isArray(reqConfig.publish) ? (reqConfig.publish as PublishTarget[]) : [],
    ai: reqConfig.ai || { provider: 'none' },
    audience: reqConfig.audience || 'developer',
    tone: reqConfig.tone || 'professional',
    enrichments: reqConfig.enrichments || [],
    jira: reqConfig.jira,
    linear: reqConfig.linear,
    gitlab: reqConfig.gitlab,
    bitbucket: reqConfig.bitbucket,
  } as CullConfig;

  try {
    const results = await verifyIntegrations(config, { only });
    json(res, 200, { results });
  } catch (err) {
    log.warn({ err: (err as Error).message, userId: user.id }, 'integrations.test failed');
    json(res, 500, { error: 'Verification failed', detail: (err as Error).message });
  }
}
