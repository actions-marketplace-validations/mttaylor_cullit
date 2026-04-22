/** Changelog releases (published versions) DB operations. */

import { sql } from './client.js';

export async function dbGetProjectOwner(project: string): Promise<string | null> {
  const rows = await sql<Array<{ user_id: string }>>`
    SELECT user_id FROM changelog_releases WHERE project = ${project} AND user_id IS NOT NULL LIMIT 1`;
  return rows.length > 0 ? rows[0].user_id : null;
}

export async function dbPublishRelease(project: string, release: {
  version: string; date: string; summary: string;
  changes: { description: string; category: string; ticketKey?: string }[];
  contributors: string[]; metadata?: Record<string, unknown>;
  formattedMd: string; formattedHtml: string;
  userId?: string;
}): Promise<void> {
  await sql`
    INSERT INTO changelog_releases (project, version, date, summary, changes, contributors, metadata, formatted_md, formatted_html, user_id)
    VALUES (${project}, ${release.version}, ${release.date}, ${release.summary},
            ${JSON.stringify(release.changes)}::jsonb, ${JSON.stringify(release.contributors)}::jsonb,
            ${release.metadata ? JSON.stringify(release.metadata) : null}::jsonb,
            ${release.formattedMd}, ${release.formattedHtml}, ${release.userId || null})
    ON CONFLICT (project, version) DO UPDATE SET
      date = EXCLUDED.date,
      summary = EXCLUDED.summary,
      changes = EXCLUDED.changes,
      contributors = EXCLUDED.contributors,
      metadata = EXCLUDED.metadata,
      formatted_md = EXCLUDED.formatted_md,
      formatted_html = EXCLUDED.formatted_html,
      user_id = EXCLUDED.user_id,
      published_at = NOW()
  `;
}

export async function dbGetReleases(project: string, limit: number): Promise<{
  version: string; date: string; summary: string;
  changes: unknown[]; contributors: string[];
  formatted: { markdown: string; html: string };
}[]> {
  interface ChangelogReleaseRow {
    version: string;
    date: string;
    summary: string;
    changes: string | unknown[];
    contributors: string | string[];
    formatted_md: string;
    formatted_html: string;
  }

  const rows = await sql<ChangelogReleaseRow[]>`
    SELECT version, date::text, summary, changes, contributors, formatted_md, formatted_html
    FROM changelog_releases
    WHERE project = ${project}
    ORDER BY published_at DESC
    LIMIT ${limit}
  `;
  return rows.map(r => ({
    version: r.version,
    date: r.date,
    summary: r.summary,
    changes: typeof r.changes === 'string' ? JSON.parse(r.changes) : r.changes,
    contributors: typeof r.contributors === 'string' ? JSON.parse(r.contributors) : r.contributors,
    formatted: { markdown: r.formatted_md, html: r.formatted_html },
  }));
}

export async function dbGetProjectCount(): Promise<number> {
  const rows = await sql<[{ count: string }]>`SELECT COUNT(DISTINCT project)::text AS count FROM changelog_releases`;
  return parseInt(rows[0].count, 10);
}

export async function dbGetUserProjectCount(userId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`SELECT COUNT(DISTINCT project)::text AS count FROM changelog_releases WHERE user_id = ${userId}`;
  return parseInt(rows[0].count, 10);
}

export async function dbDeleteRelease(project: string, version: string, userId?: string): Promise<boolean> {
  const result = userId
    ? await sql`DELETE FROM changelog_releases WHERE project = ${project} AND version = ${version} AND user_id = ${userId}`
    : await sql`DELETE FROM changelog_releases WHERE project = ${project} AND version = ${version}`;
  return result.count > 0;
}

export async function dbGetUserProjects(userId: string): Promise<string[]> {
  const rows = await sql<Array<{ project: string }>>`SELECT DISTINCT project FROM changelog_releases WHERE user_id = ${userId} ORDER BY project`;
  return rows.map(r => r.project);
}
