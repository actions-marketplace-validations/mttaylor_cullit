/**
 * Project settings — saved per-project defaults, widget config, template overlay.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';

import { isPlanFeatureAllowed } from '@cullit/core';
import { resolveUser, getEffectiveTier, getUserPlan } from '../auth.js';
import {
  dbGetProjectSettings, dbUpsertProjectSettings, dbListProjectSettings,
} from '../db.js';
import { json, readBody, parseJsonObject, isRecord, isPaidTier, type JsonObject } from '../utils.js';

const PROJECT_SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Resolve a field from body using camelCase first, then snake_case fallback. */
function pick(body: JsonObject, camel: string, snake: string): unknown {
  return body[camel] ?? body[snake];
}

/** Parse a field that can be a JSON array or a JSON-string-encoded array. */
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

export async function handleGetProjectSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  if (!isPaidTier(tier)) {
    json(res, 403, { error: 'Saved project settings require a Pro plan', upgrade: 'https://cullit.io/pricing' }); return;
  }

  const settings = await dbListProjectSettings(user.id, user.orgId);
  json(res, 200, { settings });
}

export async function handlePutProjectSettings(req: IncomingMessage, res: ServerResponse, project: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  if (!isPaidTier(tier)) {
    json(res, 403, { error: 'Saved project settings require a Pro plan', upgrade: 'https://cullit.io/pricing' }); return;
  }

  if (!PROJECT_SLUG_RE.test(project)) { json(res, 400, { error: 'Invalid project slug' }); return; }

  const raw = await readBody(req);
  const body = parseJsonObject(raw);
  if (!body) { json(res, 400, { error: 'Invalid JSON' }); return; }

  const defaultSource = pick(body, 'defaultSource', 'default_source_type');
  const defaultProvider = pick(body, 'defaultProvider', 'default_provider');
  const defaultModel = pick(body, 'defaultModel', 'default_model');
  const defaultAudience = pick(body, 'defaultAudience', 'default_audience');
  const defaultTone = pick(body, 'defaultTone', 'default_tone');
  const categories = parseArrayField(pick(body, 'categories', 'categories_json'), 20);

  const publishTargetsInput = pick(body, 'publishTargets', 'publish_targets_json');
  const publishTargets = Array.isArray(publishTargetsInput) ? publishTargetsInput.slice(0, 10) : undefined;

  const templateInput = (isRecord(body.template) ? body.template : {}) as JsonObject;
  const templateDefaultFormat = pick(templateInput, 'defaultFormat', 'default_format') ?? pick(body, 'defaultFormat', 'default_format');
  const templateProfile = templateInput.profile ?? pick(templateInput, 'templateProfile', 'template_profile') ?? pick(body, 'templateProfile', 'template_profile');
  const sectionOrderInput = pick(templateInput, 'sectionOrder', 'section_order') ?? pick(body, 'sectionOrder', 'section_order');
  const templateSectionOrder = Array.isArray(sectionOrderInput)
    ? sectionOrderInput.slice(0, 20).filter((x: unknown) => typeof x === 'string')
    : undefined;

  type WidgetConfig = { template?: { defaultFormat?: string; profile?: string; sectionOrder?: string[] } } & JsonObject;
  const widgetConfig: WidgetConfig = isRecord(body.widgetConfig) ? { ...body.widgetConfig } : {};
  const currentTemplate = isRecord(widgetConfig.template) ? { ...widgetConfig.template } : {};
  if (typeof templateDefaultFormat === 'string') currentTemplate.defaultFormat = templateDefaultFormat;
  if (typeof templateProfile === 'string') currentTemplate.profile = templateProfile;
  if (templateSectionOrder) currentTemplate.sectionOrder = templateSectionOrder;
  if (Object.keys(currentTemplate).length) widgetConfig.template = currentTemplate;

  if (widgetConfig.branding === false) {
    const plan = await getUserPlan(user);
    if (!isPlanFeatureAllowed('branded_widget', plan, tier)) {
      json(res, 403, { error: 'Branded widget (removing Cullit branding) requires a Pro plan', upgrade: 'https://cullit.io/pricing' });
      return;
    }
  }

  const existing = await dbGetProjectSettings(user.id, project, user.orgId);

  const settings = await dbUpsertProjectSettings({
    id: existing?.id || randomBytes(12).toString('hex'),
    orgId: user.orgId,
    userId: user.id,
    project,
    defaultSource: defaultSource as string | undefined,
    defaultProvider: defaultProvider as string | undefined,
    defaultModel: defaultModel as string | undefined,
    defaultAudience: defaultAudience as string | undefined,
    defaultTone: defaultTone as string | undefined,
    categoriesJson: categories,
    publishTargetsJson: publishTargets,
    widgetConfigJson: Object.keys(widgetConfig).length ? widgetConfig : undefined,
  });

  json(res, 200, { settings });
}
