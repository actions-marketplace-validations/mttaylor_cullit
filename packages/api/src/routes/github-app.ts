/**
 * GitHub App routes — installation linking + user-facing list/disconnect.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import { resolveUser } from '../auth.js';
import { sql, dbGetUserByLogin, dbGetUserByGithubUsername } from '../db.js';
import { log } from '../logger.js';
import { json, readJsonBody, timingSafeCompare, ErrorCode } from '../utils.js';

const APP_SECRET = process.env['CULLIT_APP_SECRET'] || '';

/** Endpoint called by the GitHub App server to link an installation to a Cullit user. */
export async function handleAppInstallation(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = req.headers['authorization'] || '';
  if (!APP_SECRET || !auth.startsWith('Bearer ') || !timingSafeCompare(auth.slice(7), APP_SECRET)) {
    json(res, 401, { error: 'Unauthorized', code: ErrorCode.AUTH_UNAUTHORIZED });
    return;
  }

  const body = await readJsonBody(req, res) as { installationId?: number; githubLogin?: string; repos?: string[] } | null;
  if (!body) return;

  if (!body.installationId || !body.githubLogin) {
    json(res, 400, { error: 'installationId and githubLogin are required' }); return;
  }
  if (!sql) { json(res, 503, { error: 'Database not configured' }); return; }

  const user = await dbGetUserByGithubUsername(body.githubLogin) || await dbGetUserByLogin(body.githubLogin);
  if (!user) {
    await sql`
      INSERT INTO github_installations (installation_id, user_id, github_login, repos, created_at)
      VALUES (${body.installationId}, ${null}, ${body.githubLogin}, ${JSON.stringify(body.repos || [])}, NOW())
      ON CONFLICT (installation_id) DO UPDATE SET
        github_login = EXCLUDED.github_login,
        repos = EXCLUDED.repos
    `;
    log.info({ githubLogin: body.githubLogin }, 'No Cullit user found for GitHub login — installation stored, will link on next login');
    json(res, 200, { linked: false, reason: 'User not found — will link on next login' });
    return;
  }

  await sql`
    INSERT INTO github_installations (installation_id, user_id, github_login, repos, created_at)
    VALUES (${body.installationId}, ${user.id}, ${body.githubLogin}, ${JSON.stringify(body.repos || [])}, NOW())
    ON CONFLICT (installation_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      github_login = EXCLUDED.github_login,
      repos = EXCLUDED.repos
  `;

  log.info({ installationId: body.installationId, userId: user.id, githubLogin: body.githubLogin }, 'GitHub App installation linked');
  json(res, 200, { linked: true, userId: user.id });
}

export async function handleGitHubInstallations(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!sql) { json(res, 200, { installations: [] }); return; }
  const rows = await sql`SELECT installation_id, github_login, repos, created_at FROM github_installations WHERE user_id = ${user.id}`;
  json(res, 200, { installations: rows });
}

export async function handleGitHubDisconnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  const body = await readJsonBody(req, res) as { installationId?: number } | null;
  if (!body?.installationId) { json(res, 400, { error: 'installationId is required' }); return; }
  if (!sql) { json(res, 503, { error: 'Database not configured' }); return; }
  await sql`DELETE FROM github_installations WHERE installation_id = ${body.installationId} AND user_id = ${user.id}`;
  json(res, 200, { disconnected: true });
}
