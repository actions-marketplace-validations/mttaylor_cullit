/**
 * Draft workflow route handlers.
 *
 * Team-tier feature: create, review, approve, and publish release note drafts.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { json, readBody, parseJsonObject, PORT } from '../utils.js';
import { resolveUser, getEffectiveTier } from '../auth.js';
import {
  dbCreateDraft, dbGetDraft, dbListDrafts, dbUpdateDraft, dbUpdateDraftStatus, dbDeleteDraft,
  dbCreateRevision, dbGetRevisions, dbGetRevisionCount, dbPublishRelease,
} from '../db.js';

// --- Helpers ---

const VALID_DRAFT_STATUSES = new Set(['draft', 'submitted', 'approved', 'published']);

function isTeamTier(tier: string): boolean {
  return tier === 'team' || tier === 'enterprise';
}

function hasDraftAccess(user: { id: string; orgId: string | null }, draft: { user_id: string; org_id: string | null }): boolean {
  if (draft.user_id === user.id) return true;
  return !!draft.org_id && !!user.orgId && draft.org_id === user.orgId;
}

function hasDraftAdminAccess(user: { id: string; orgId: string | null; role: string }, draft: { user_id: string; org_id: string | null }): boolean {
  if (draft.user_id === user.id) return true;
  return !!draft.org_id && !!user.orgId && draft.org_id === user.orgId && (user.role === 'owner' || user.role === 'admin');
}

// --- Handlers ---

export async function handleCreateDraft(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  if (!isTeamTier(tier)) {
    json(res, 403, { error: 'Release drafts require a Team plan', upgrade: 'https://cullit.io/pricing' }); return;
  }

  const raw = await readBody(req);
  const body = parseJsonObject(raw);
  if (!body) { json(res, 400, { error: 'Invalid JSON' }); return; }

  const project = typeof body.project === 'string' ? body.project : '';

  if (!project) {
    json(res, 400, { error: '"project" is required' }); return;
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(project)) {
    json(res, 400, { error: '"project" must be 1-64 alphanumeric characters, hyphens, or underscores' }); return;
  }

  const draft = await dbCreateDraft({
    id: randomBytes(12).toString('hex'),
    orgId: user.orgId,
    userId: user.id,
    project,
    version: String(body.version || '').slice(0, 64),
    sourceType: typeof body.sourceType === 'string' ? body.sourceType : 'local',
    provider: typeof body.provider === 'string' ? body.provider : 'none',
    model: typeof body.model === 'string' ? body.model : '',
    audience: typeof body.audience === 'string' ? body.audience : 'developer',
    tone: typeof body.tone === 'string' ? body.tone : 'professional',
    notesJson: Array.isArray(body.notes) ? body.notes.slice(0, 200) : [],
    formattedMd: String(body.formattedMd || '').slice(0, 50_000),
    formattedHtml: String(body.formattedHtml || '').slice(0, 100_000),
    rawInputsJson: body.rawInputs || null,
    createdBy: user.id,
  });

  json(res, 201, { draft });
}

export async function handleListDrafts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const tier = getEffectiveTier(user);
  if (!isTeamTier(tier)) {
    json(res, 403, { error: 'Release drafts require a Team plan', upgrade: 'https://cullit.io/pricing' }); return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));
  const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);
  const statusFilter = url.searchParams.get('status') || undefined;
  if (statusFilter && !VALID_DRAFT_STATUSES.has(statusFilter)) {
    json(res, 400, { error: 'Invalid status filter' }); return;
  }

  const result = await dbListDrafts({
    userId: user.id,
    orgId: user.orgId || undefined,
    status: statusFilter,
    limit,
    offset,
  });

  json(res, 200, { drafts: result.drafts, total: result.total, limit, offset });
}

export async function handleGetDraft(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }

  if (!hasDraftAccess(user, draft)) {
    json(res, 403, { error: 'Access denied' }); return;
  }

  const revisions = await dbGetRevisions(draftId);
  json(res, 200, { draft, revisions });
}

export async function handleUpdateDraft(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }

  if (!hasDraftAdminAccess(user, draft)) {
    json(res, 403, { error: 'Access denied' }); return;
  }

  if (draft.status === 'published') {
    json(res, 409, { error: 'Cannot edit a published draft' }); return;
  }

  const raw = await readBody(req);
  const body = parseJsonObject(raw);
  if (!body) { json(res, 400, { error: 'Invalid JSON' }); return; }

  // Save revision before updating
  const revisionNum = await dbGetRevisionCount(draftId);
  await dbCreateRevision({
    id: randomBytes(12).toString('hex'),
    draftId,
    revisionNumber: revisionNum + 1,
    notesJson: typeof draft.notes_json === 'string' ? JSON.parse(draft.notes_json as string) : (draft.notes_json || []),
    formattedMd: draft.formatted_md,
    formattedHtml: draft.formatted_html,
    changedBy: user.id,
  });

  const updated = await dbUpdateDraft(draftId, {
    version: typeof body.version === 'string' ? String(body.version) : undefined,
    notesJson: Array.isArray(body.notes) ? (body.notes as unknown[]).slice(0, 200) : undefined,
    formattedMd: body.formattedMd ? String(body.formattedMd).slice(0, 50_000) : undefined,
    formattedHtml: body.formattedHtml ? String(body.formattedHtml).slice(0, 100_000) : undefined,
    audience: typeof body.audience === 'string' ? String(body.audience) : undefined,
    tone: typeof body.tone === 'string' ? String(body.tone) : undefined,
  });

  json(res, 200, { draft: updated });
}

export async function handleDraftSubmit(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }
  if (!hasDraftAccess(user, draft)) {
    json(res, 403, { error: 'Access denied' }); return;
  }
  if (draft.status !== 'draft') {
    json(res, 409, { error: 'Draft must be in "draft" status to submit for review' }); return;
  }

  const updated = await dbUpdateDraftStatus(draftId, 'submitted');
  json(res, 200, { draft: updated });
}

export async function handleDeleteDraft(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }
  if (!hasDraftAdminAccess(user, draft)) {
    json(res, 403, { error: 'Access denied' }); return;
  }
  if (draft.status === 'published') {
    json(res, 409, { error: 'Cannot delete a published draft' }); return;
  }

  const deleted = await dbDeleteDraft(draftId);
  if (!deleted) { json(res, 404, { error: 'Draft not found' }); return; }
  json(res, 200, { ok: true });
}

export async function handleDraftApprove(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  if (user.role !== 'owner' && user.role !== 'admin') {
    json(res, 403, { error: 'Only org owners and admins can approve drafts' }); return;
  }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }
  if (draft.org_id !== user.orgId) {
    json(res, 403, { error: 'Access denied' }); return;
  }
  if (draft.status !== 'submitted') {
    json(res, 409, { error: 'Draft must be in "submitted" status to approve' }); return;
  }

  const updated = await dbUpdateDraftStatus(draftId, 'approved', user.id);
  json(res, 200, { draft: updated });
}

export async function handleDraftPublish(req: IncomingMessage, res: ServerResponse, draftId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  if (user.role !== 'owner' && user.role !== 'admin') {
    json(res, 403, { error: 'Only org owners and admins can publish drafts' }); return;
  }

  const draft = await dbGetDraft(draftId);
  if (!draft) { json(res, 404, { error: 'Draft not found' }); return; }
  if (draft.org_id !== user.orgId) {
    json(res, 403, { error: 'Access denied' }); return;
  }
  if (draft.status !== 'approved') {
    json(res, 409, { error: 'Draft must be approved before publishing' }); return;
  }

  // Publish to changelog
  if (draft.version) {
    await dbPublishRelease(draft.project, {
      version: draft.version,
      date: new Date().toISOString().split('T')[0],
      summary: draft.formatted_md.slice(0, 2000),
      changes: typeof draft.notes_json === 'string' ? JSON.parse(draft.notes_json as string) : (draft.notes_json as unknown[]),
      contributors: [],
      formattedMd: draft.formatted_md,
      formattedHtml: draft.formatted_html,
    });
  }

  const updated = await dbUpdateDraftStatus(draftId, 'published');
  json(res, 200, { draft: updated });
}
