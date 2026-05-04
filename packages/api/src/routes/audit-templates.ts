/**
 * Audit log + Project templates routes.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';

import { resolveUser } from '../auth.js';
import {
  dbGetAuditEvents, dbRecordAuditEvent,
  dbCreateProjectTemplate, dbListProjectTemplates, dbDeleteProjectTemplate,
} from '../db.js';
import { json, readBody, parseJsonObject, isRecord, PORT } from '../utils.js';

// ---- Audit log ----

export async function handleGetAuditLog(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 50 : rawLimit, 100));
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  const result = await dbGetAuditEvents(user.id, limit, offset);
  json(res, 200, { events: result.events, total: result.total, limit, offset });
}

// ---- Project Templates ----

const TEMPLATE_ID_RE = /^tpl_[a-f0-9]{24}$/;

async function requireTemplateAccess(req: IncomingMessage, res: ServerResponse) {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return null; }
  if (!user.orgId) { json(res, 400, { error: 'Project templates require an organization' }); return null; }
  return user;
}

export async function handleListTemplates(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireTemplateAccess(req, res);
  if (!user) return;
  const templates = await dbListProjectTemplates(user.orgId!);
  json(res, 200, { templates });
}

export async function handleCreateTemplate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireTemplateAccess(req, res);
  if (!user) return;

  const raw = await readBody(req);
  const body = parseJsonObject(raw);
  if (!body) { json(res, 400, { error: 'Invalid JSON' }); return; }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name) { json(res, 400, { error: 'Template name is required' }); return; }

  const config = isRecord(body.config) ? body.config : {};
  const id = `tpl_${randomBytes(12).toString('hex')}`;

  const template = await dbCreateProjectTemplate({ id, orgId: user.orgId!, name, config, createdBy: user.id });
  await dbRecordAuditEvent({ userId: user.id, action: 'template.create', target: id, metadata: { name } });
  json(res, 201, { template });
}

export async function handleDeleteTemplate(req: IncomingMessage, res: ServerResponse, templateId: string): Promise<void> {
  const user = await requireTemplateAccess(req, res);
  if (!user) return;

  if (!TEMPLATE_ID_RE.test(templateId)) { json(res, 400, { error: 'Invalid template ID' }); return; }

  const deleted = await dbDeleteProjectTemplate(templateId, user.orgId!);
  if (!deleted) { json(res, 404, { error: 'Template not found' }); return; }

  await dbRecordAuditEvent({ userId: user.id, action: 'template.delete', target: templateId });
  json(res, 200, { ok: true });
}
