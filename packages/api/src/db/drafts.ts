/** Release draft + draft revision DB operations. */

import { sql } from './client.js';

export type DraftStatus = 'draft' | 'submitted' | 'approved' | 'published';

export interface DbDraft {
  id: string;
  org_id: string | null;
  user_id: string;
  project: string;
  version: string;
  status: DraftStatus;
  source_type: string;
  provider: string;
  model: string;
  audience: string;
  tone: string;
  notes_json: unknown[];
  formatted_md: string;
  formatted_html: string;
  raw_inputs_json: unknown | null;
  created_by: string;
  approved_by: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DbRevision {
  id: string;
  draft_id: string;
  revision_number: number;
  notes_json: unknown[];
  formatted_md: string;
  formatted_html: string;
  changed_by: string;
  created_at: Date;
}

/**
 * Atomically publish a release AND mark the draft as published in a single transaction.
 * Prevents duplicates if the server crashes between the two writes.
 */
export async function dbPublishDraftWithRelease(draftId: string, project: string, release: {
  version: string; date: string; summary: string;
  changes: { description: string; category: string; ticketKey?: string }[];
  contributors: string[];
  formattedMd: string; formattedHtml: string;
}): Promise<DbDraft | null> {
  return sql.begin(async (tx: any) => {
    await tx`
      INSERT INTO changelog_releases (project, version, date, summary, changes, contributors, formatted_md, formatted_html)
      VALUES (${project}, ${release.version}, ${release.date}, ${release.summary},
              ${JSON.stringify(release.changes)}::jsonb, ${JSON.stringify(release.contributors)}::jsonb,
              ${release.formattedMd}, ${release.formattedHtml})
      ON CONFLICT (project, version) DO UPDATE SET
        date = EXCLUDED.date, summary = EXCLUDED.summary, changes = EXCLUDED.changes,
        contributors = EXCLUDED.contributors, formatted_md = EXCLUDED.formatted_md,
        formatted_html = EXCLUDED.formatted_html, published_at = NOW()
    `;
    const rows = await tx<DbDraft[]>`
      UPDATE release_drafts SET status = 'published', published_at = NOW(), updated_at = NOW()
      WHERE id = ${draftId} RETURNING *
    `;
    return rows[0] || null;
  });
}

export async function dbCreateDraft(draft: {
  id: string; orgId: string | null; userId: string; project: string; version: string;
  sourceType: string; provider: string; model: string; audience: string; tone: string;
  notesJson: unknown[]; formattedMd: string; formattedHtml: string; rawInputsJson?: unknown;
  createdBy: string;
}): Promise<DbDraft> {
  const rows = await sql<DbDraft[]>`
    INSERT INTO release_drafts (id, org_id, user_id, project, version, source_type, provider, model, audience, tone,
      notes_json, formatted_md, formatted_html, raw_inputs_json, created_by)
    VALUES (${draft.id}, ${draft.orgId}, ${draft.userId}, ${draft.project}, ${draft.version},
      ${draft.sourceType}, ${draft.provider}, ${draft.model}, ${draft.audience}, ${draft.tone},
      ${JSON.stringify(draft.notesJson)}::jsonb, ${draft.formattedMd}, ${draft.formattedHtml},
      ${draft.rawInputsJson ? JSON.stringify(draft.rawInputsJson) : null}::jsonb, ${draft.createdBy})
    RETURNING *
  `;
  return rows[0];
}

export async function dbGetDraft(id: string): Promise<DbDraft | null> {
  const rows = await sql<DbDraft[]>`SELECT * FROM release_drafts WHERE id = ${id}`;
  return rows[0] || null;
}

export async function dbListDrafts(opts: {
  userId?: string; orgId?: string; status?: string; limit: number; offset: number;
}): Promise<{ drafts: DbDraft[]; total: number }> {
  let drafts: DbDraft[];
  let total: number;

  if (opts.orgId && opts.status) {
    drafts = await sql<DbDraft[]>`
      SELECT * FROM release_drafts WHERE org_id = ${opts.orgId} AND status = ${opts.status}
      ORDER BY updated_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    const countRows = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM release_drafts WHERE org_id = ${opts.orgId} AND status = ${opts.status}`;
    total = parseInt(countRows[0].count, 10);
  } else if (opts.orgId) {
    drafts = await sql<DbDraft[]>`
      SELECT * FROM release_drafts WHERE org_id = ${opts.orgId}
      ORDER BY updated_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    const countRows = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM release_drafts WHERE org_id = ${opts.orgId}`;
    total = parseInt(countRows[0].count, 10);
  } else if (opts.userId && opts.status) {
    drafts = await sql<DbDraft[]>`
      SELECT * FROM release_drafts WHERE user_id = ${opts.userId} AND status = ${opts.status}
      ORDER BY updated_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    const countRows = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM release_drafts WHERE user_id = ${opts.userId} AND status = ${opts.status}`;
    total = parseInt(countRows[0].count, 10);
  } else if (opts.userId) {
    drafts = await sql<DbDraft[]>`
      SELECT * FROM release_drafts WHERE user_id = ${opts.userId}
      ORDER BY updated_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    const countRows = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM release_drafts WHERE user_id = ${opts.userId}`;
    total = parseInt(countRows[0].count, 10);
  } else {
    drafts = [];
    total = 0;
  }

  return { drafts, total };
}

export async function dbUpdateDraft(id: string, updates: {
  version?: string; notesJson?: unknown[]; formattedMd?: string; formattedHtml?: string;
  audience?: string; tone?: string;
}, expectedUpdatedAt?: string): Promise<DbDraft | null> {
  const condition = expectedUpdatedAt
    ? sql`AND updated_at = ${expectedUpdatedAt}`
    : sql``;
  const rows = await sql<DbDraft[]>`
    UPDATE release_drafts SET
      version = COALESCE(${updates.version ?? null}, version),
      notes_json = COALESCE(${updates.notesJson ? JSON.stringify(updates.notesJson) : null}::jsonb, notes_json),
      formatted_md = COALESCE(${updates.formattedMd ?? null}, formatted_md),
      formatted_html = COALESCE(${updates.formattedHtml ?? null}, formatted_html),
      audience = COALESCE(${updates.audience ?? null}, audience),
      tone = COALESCE(${updates.tone ?? null}, tone),
      updated_at = NOW()
    WHERE id = ${id} ${condition}
    RETURNING *
  `;
  return rows[0] || null;
}

export async function dbUpdateDraftStatus(id: string, status: DraftStatus, actorId?: string): Promise<DbDraft | null> {
  if (status === 'approved' && actorId) {
    const rows = await sql<DbDraft[]>`
      UPDATE release_drafts SET status = ${status}, approved_by = ${actorId}, updated_at = NOW()
      WHERE id = ${id} AND status = 'submitted' RETURNING *`;
    return rows[0] || null;
  }
  if (status === 'published') {
    const rows = await sql<DbDraft[]>`
      UPDATE release_drafts SET status = ${status}, published_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND status = 'approved' RETURNING *`;
    return rows[0] || null;
  }
  if (status === 'submitted') {
    const rows = await sql<DbDraft[]>`
      UPDATE release_drafts SET status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND status = 'draft' RETURNING *`;
    return rows[0] || null;
  }
  const rows = await sql<DbDraft[]>`
    UPDATE release_drafts SET status = ${status}, updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return rows[0] || null;
}

export async function dbDeleteDraft(id: string): Promise<boolean> {
  const result = await sql`DELETE FROM release_drafts WHERE id = ${id}`;
  return result.count > 0;
}

// --- Draft revisions ---

export async function dbCreateRevision(rev: {
  id: string; draftId: string; revisionNumber: number;
  notesJson: unknown[]; formattedMd: string; formattedHtml: string; changedBy: string;
}): Promise<DbRevision> {
  const rows = await sql<DbRevision[]>`
    INSERT INTO draft_revisions (id, draft_id, revision_number, notes_json, formatted_md, formatted_html, changed_by)
    VALUES (${rev.id}, ${rev.draftId}, ${rev.revisionNumber},
      ${JSON.stringify(rev.notesJson)}::jsonb, ${rev.formattedMd}, ${rev.formattedHtml}, ${rev.changedBy})
    RETURNING *
  `;
  return rows[0];
}

export async function dbGetRevisions(draftId: string): Promise<DbRevision[]> {
  return sql<DbRevision[]>`
    SELECT * FROM draft_revisions WHERE draft_id = ${draftId} ORDER BY revision_number DESC
  `;
}

export async function dbGetRevisionCount(draftId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM draft_revisions WHERE draft_id = ${draftId}`;
  return parseInt(rows[0].count, 10);
}
