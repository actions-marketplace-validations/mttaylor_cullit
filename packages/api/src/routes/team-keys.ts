/**
 * Team API Key Management Routes
 *
 * Handles CRUD for seat-based team API keys.
 * Only org owners and admins can manage keys.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { resolveUser, getOrg, generateApiKey } from '../auth.js';
import {
  dbGetTeamApiKeys, dbUpdateTeamApiKeyAssignment,
  dbUpdateTeamApiKeyLabel, dbRevokeTeamApiKey, dbRotateTeamApiKey,
  dbRecordAuditEvent,
} from '../db.js';
import { json, readJsonBody, requireAuth, requireOrgAdmin, type CorsResponse } from '../utils.js';
import { sendTeamApiKey } from '../email.js';
import { log } from '../logger.js';

/**
 * GET /v1/org/keys — List all team API keys for the caller's org
 */
export async function handleListTeamKeys(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireAuth(resolveUser, req, res as CorsResponse);
  if (!user) return;
  if (!user.orgId) { json(res as CorsResponse, 403, { error: 'No organization. Subscribe to a Pro plan first.' }); return; }

  const keys = await dbGetTeamApiKeys(user.orgId);

  // Only show masked key prefixes — full key is shown only at creation/rotation time
  json(res, 200, {
    keys: keys.map(k => ({
      id: k.id,
      apiKeyPrefix: (k.api_key_hash || '').slice(0, 8) + '...',
      label: k.label,
      assignedToEmail: k.assigned_to_email,
      assignedToName: k.assigned_to_name,
      assignedAt: k.assigned_at,
      revokedAt: k.revoked_at,
      createdAt: k.created_at,
    })),
  });
}

/**
 * PATCH /v1/org/keys/:id — Update a team key's label or assignment
 */
export async function handleUpdateTeamKey(req: IncomingMessage, res: ServerResponse, keyId: string): Promise<void> {
  const user = await requireOrgAdmin(resolveUser, req, res as CorsResponse, 'manage team keys');
  if (!user) return;

  const body = await readJsonBody(req, res);
  if (!body) return;

  if (typeof body.label === 'string') {
    if (body.label.length > 64) { json(res, 400, { error: 'Label must be 64 characters or less' }); return; }
    const updated = await dbUpdateTeamApiKeyLabel(keyId, user.orgId, body.label);
    if (!updated) { json(res, 404, { error: 'Key not found' }); return; }
  }

  if (body.assignedToEmail !== undefined) {
    const email = body.assignedToEmail ? String(body.assignedToEmail).toLowerCase().trim() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { json(res, 400, { error: 'Valid email required' }); return; }
    const name = body.assignedToName ? String(body.assignedToName).trim() : null;
    const updated = await dbUpdateTeamApiKeyAssignment(keyId, user.orgId, email, name);
    if (!updated) { json(res, 404, { error: 'Key not found' }); return; }
  }

  json(res, 200, { updated: true });
}

/**
 * POST /v1/org/keys/:id/send — Email a team key to its assigned recipient
 */
export async function handleSendTeamKey(req: IncomingMessage, res: ServerResponse, keyId: string): Promise<void> {
  const user = await requireOrgAdmin(resolveUser, req, res as CorsResponse, 'send keys');
  if (!user) return;

  const keys = await dbGetTeamApiKeys(user.orgId);
  const key = keys.find(k => k.id === keyId);
  if (!key) { json(res, 404, { error: 'Key not found' }); return; }
  if (key.revoked_at) { json(res, 400, { error: 'Cannot send a revoked key' }); return; }
  if (!key.assigned_to_email) { json(res, 400, { error: 'Assign an email to this key first' }); return; }

  const org = await getOrg(user.orgId);
  const orgName = org?.name || 'your team';
  const senderName = user.name || user.login;
  const recipientName = key.assigned_to_name || key.assigned_to_email.split('@')[0];

  const emailSent = await sendTeamApiKey(
    key.assigned_to_email, recipientName, orgName, senderName, key.label,
  );

  log.info({ actor: user.id, keyId, email: key.assigned_to_email }, 'Team API key sent via email');
  json(res, 200, { sent: emailSent });
}

/**
 * POST /v1/org/keys/:id/revoke — Revoke a team key
 */
export async function handleRevokeTeamKey(req: IncomingMessage, res: ServerResponse, keyId: string): Promise<void> {
  const user = await requireOrgAdmin(resolveUser, req, res as CorsResponse, 'revoke keys');
  if (!user) return;

  const revoked = await dbRevokeTeamApiKey(keyId, user.orgId);
  if (!revoked) { json(res, 404, { error: 'Key not found or already revoked' }); return; }

  await dbRecordAuditEvent({ userId: user.id, action: 'team_key.revoke', target: keyId, metadata: { orgId: user.orgId } }).catch(() => {});
  log.info({ actor: user.id, keyId, action: 'team_key.revoke' }, 'Team API key revoked');
  json(res, 200, { revoked: true });
}

/**
 * POST /v1/org/keys/:id/rotate — Rotate a team key (generate a new value)
 */
export async function handleRotateTeamKey(req: IncomingMessage, res: ServerResponse, keyId: string): Promise<void> {
  const user = await requireOrgAdmin(resolveUser, req, res as CorsResponse, 'rotate keys');
  if (!user) return;

  const newApiKey = generateApiKey();
  const updated = await dbRotateTeamApiKey(keyId, user.orgId, newApiKey);
  if (!updated) { json(res, 404, { error: 'Key not found or revoked' }); return; }

  await dbRecordAuditEvent({ userId: user.id, action: 'team_key.rotate', target: keyId, metadata: { orgId: user.orgId } }).catch(() => {});
  log.info({ actor: user.id, keyId, action: 'team_key.rotate' }, 'Team API key rotated');
  json(res, 200, { apiKey: newApiKey });
}
