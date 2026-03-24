/**
 * Changelog route handlers.
 *
 * Manages the hosted changelog store — publish, list, delete releases.
 * Supports both in-memory (file-backed) and PostgreSQL persistence.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { json, readBody, parseJsonObject, toStringArray, isRecord, sanitizeHtml, PORT } from '../utils.js';
import type { JsonObject } from '../utils.js';
import { resolveUser, useDb } from '../auth.js';
import { dbPublishRelease, dbGetReleases, dbGetProjectCount, dbDeleteRelease, sql } from '../db.js';
import { log } from '../logger.js';

// --- Changelog types & store ---

export interface ChangelogRelease {
  version: string;
  date: string;
  summary: string;
  changes: { description: string; category: string; ticketKey?: string }[];
  contributors: string[];
  metadata?: Record<string, unknown>;
  formatted: { markdown: string; html: string };
  publishedAt: string;
  userId?: string;
}

const CHANGELOG_FILE = process.env['CHANGELOG_STORE_PATH'] || './changelog-store.json';
const MAX_RELEASES_PER_PROJECT = 100;
const changelogStore = new Map<string, ChangelogRelease[]>();

function loadChangelogStore(): void {
  try {
    if (existsSync(CHANGELOG_FILE)) {
      const data = JSON.parse(readFileSync(CHANGELOG_FILE, 'utf-8'));
      for (const [project, releases] of Object.entries(data)) {
        if (typeof project === 'string' && Array.isArray(releases)) {
          changelogStore.set(project, releases as ChangelogRelease[]);
        }
      }
      log.info({ projects: changelogStore.size }, 'Loaded changelog store');
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Failed to load changelog store');
  }
}

function saveChangelogStore(): void {
  try {
    const data: Record<string, ChangelogRelease[]> = {};
    for (const [project, releases] of changelogStore) {
      data[project] = releases;
    }
    const tmp = CHANGELOG_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmp, CHANGELOG_FILE);
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Failed to save changelog store');
  }
}

loadChangelogStore();

// --- Handlers ---

export async function handleChangelogPublish(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const raw = await readBody(req);
  const body = parseJsonObject(raw);
  if (!body) {
    json(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const project = typeof body.project === 'string' ? body.project : '';
  const version = typeof body.version === 'string' ? body.version : '';

  if (!project) {
    json(res, 400, { error: '"project" is required (string)' });
    return;
  }
  if (!version) {
    json(res, 400, { error: '"version" is required (string)' });
    return;
  }

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(project)) {
    json(res, 400, { error: '"project" must be 1-64 alphanumeric characters, hyphens, or underscores' });
    return;
  }

  if (version.length > 64) {
    json(res, 400, { error: '"version" must be under 64 characters' });
    return;
  }

  if (!Array.isArray(body.changes)) {
    json(res, 400, { error: '"changes" must be an array' });
    return;
  }

  const contributors = toStringArray(body.contributors, 50) || [];

  const release: ChangelogRelease = {
    version,
    date: typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().split('T')[0],
    summary: String(body.summary || '').slice(0, 2000),
    changes: body.changes.slice(0, 50).map(c => {
      const item = isRecord(c) ? c : {};
      return {
        description: String(item.description || '').slice(0, 500),
        category: String(item.category || 'chores').slice(0, 50),
        ticketKey: item.ticketKey ? String(item.ticketKey).slice(0, 32) : undefined,
      };
    }),
    contributors,
    metadata: body.metadata
      ? JSON.parse(JSON.stringify(body.metadata, (k: string, v: unknown) => k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v))
      : undefined,
    formatted: {
      markdown: String(body.formatted?.markdown || '').slice(0, 50_000),
      html: sanitizeHtml(String(body.formatted?.html || '').slice(0, 100_000)),
    },
    publishedAt: new Date().toISOString(),
    userId: user.id,
  };

  const MAX_PROJECTS = 1000;

  // DB-backed persistence when available
  if (useDb) {
    const projectCount = await dbGetProjectCount();
    if (projectCount >= MAX_PROJECTS) {
      json(res, 409, { error: 'Maximum number of projects reached' });
      return;
    }
    await dbPublishRelease(project, {
      version: release.version,
      date: release.date,
      summary: release.summary,
      changes: release.changes,
      contributors: release.contributors,
      metadata: release.metadata,
      formattedMd: release.formatted.markdown,
      formattedHtml: release.formatted.html,
      userId: user.id,
    });
  } else {
    if (!changelogStore.has(project) && changelogStore.size >= MAX_PROJECTS) {
      json(res, 409, { error: 'Maximum number of projects reached' });
      return;
    }

    const releases = changelogStore.get(project) || [];
    const existingIdx = releases.findIndex(r => r.version === release.version);
    if (existingIdx >= 0) {
      releases[existingIdx] = release;
    } else {
      releases.unshift(release);
      if (releases.length > MAX_RELEASES_PER_PROJECT) {
        releases.length = MAX_RELEASES_PER_PROJECT;
      }
    }

    changelogStore.set(project, releases);
    saveChangelogStore();
  }

  json(res, 201, {
    ok: true,
    url: `https://cullit.io/changelog/${project}`,
    version: release.version,
    project,
  });
}

export async function handleChangelogLatest(req: IncomingMessage, res: ServerResponse, project: string): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 50));

  if (useDb) {
    const result = await dbGetReleases(project, limit);
    json(res, 200, { project, releases: result });
    return;
  }

  const releases = changelogStore.get(project);
  if (!releases || releases.length === 0) {
    json(res, 200, { project, releases: [] });
    return;
  }

  const result = releases.slice(0, limit).map(r => ({
    version: r.version,
    date: r.date,
    summary: r.summary,
    changes: r.changes,
    contributors: r.contributors,
    formatted: r.formatted,
  }));

  json(res, 200, { project, releases: result });
}

export async function handleChangelogDelete(req: IncomingMessage, res: ServerResponse, project: string, version: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  if (useDb) {
    const deleted = await dbDeleteRelease(project, version, user.id);
    if (!deleted) { json(res, 404, { error: 'Release not found or not owned by you' }); return; }
  } else {
    const releases = changelogStore.get(project);
    if (!releases) { json(res, 404, { error: 'Release not found' }); return; }
    const idx = releases.findIndex(r => r.version === version && r.userId === user.id);
    if (idx < 0) { json(res, 404, { error: 'Release not found or not owned by you' }); return; }
    releases.splice(idx, 1);
    if (releases.length === 0) changelogStore.delete(project);
    saveChangelogStore();
  }

  json(res, 200, { ok: true, project, version });
}

export async function handleChangelogListProjects(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  if (useDb) {
    const rows = await sql<Array<{ project: string }>>`SELECT DISTINCT project FROM changelog_releases ORDER BY project`;
    json(res, 200, { projects: rows.map(r => r.project) });
  } else {
    json(res, 200, { projects: Array.from(changelogStore.keys()).sort() });
  }
}
