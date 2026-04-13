/**
 * Organization route handlers.
 *
 * Manages orgs, membership, invites, roles, and org-level usage stats.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { json, readBody, readJsonBody, isTeamTier } from '../utils.js';
import { log } from '../logger.js';
import {
  resolveUser, getUser, getOrg, createOrg, addOrgMember, removeOrgMember, getOrgMembers,
  getEffectiveTier,
} from '../auth.js';
import {
  getUsageStats, getMonthlyGenerationCount,
} from '../store.js';
import {
  dbCreateOrgInvite, dbListOrgInvites, dbDeleteOrgInvite, dbGetOrgInviteByToken,
  dbAcceptOrgInvite, dbUpdateOrgMemberRole, dbUpdateOrgSettings,
} from '../db.js';
import { sendOrgInvite } from '../email.js';
import { getTeamLimits, TEAM_MIN_SEATS } from '@cullit/core';

// --- Org CRUD ---

export async function handleGetOrg(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId) { json(res, 200, { org: null }); return; }

  const org = await getOrg(user.orgId);
  if (!org) { json(res, 200, { org: null }); return; }

  const members = (await getOrgMembers(org.id)).map(m => ({
    id: m.id, login: m.login, name: m.name, avatarUrl: m.avatarUrl, role: m.role,
  }));

  json(res, 200, {
    org: { id: org.id, name: org.name, slug: org.slug, tier: org.tier, maxSeats: org.maxSeats, memberCount: members.length, createdAt: org.createdAt },
    members,
  });
}

export async function handleCreateOrg(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (user.orgId) { json(res, 409, { error: 'Already a member of an organization' }); return; }

  const tier = getEffectiveTier(user);
  if (!isTeamTier(tier)) {
    json(res, 403, { error: 'Paid plan required to create an organization' }); return;
  }

  const body = await readJsonBody(req, res);
  if (!body) return;

  if (!body.name || typeof body.name !== 'string' || (body.name as string).length < 2 || (body.name as string).length > 64) {
    json(res, 400, { error: '"name" is required (2-64 characters)' }); return;
  }

  const org = await createOrg(body.name, user);
  log.info({ actor: user.id, action: 'org.create', resource: org.id }, 'Organization created');
  json(res, 201, { org: { id: org.id, name: org.name, slug: org.slug, tier: org.tier } });
}

export async function handleUpdateOrgSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || user.role !== 'owner') {
    json(res, 403, { error: 'Only org owners can update settings' }); return;
  }

  const body = await readJsonBody(req, res);
  if (!body) return;

  if (typeof body.requireSeparateApprover !== 'boolean') {
    json(res, 400, { error: '"requireSeparateApprover" must be a boolean' }); return;
  }

  const org = await getOrg(user.orgId);
  if (!org) { json(res, 404, { error: 'Organization not found' }); return; }

  await dbUpdateOrgSettings(user.orgId, { requireSeparateApprover: body.requireSeparateApprover });
  log.info({ actor: user.id, action: 'org.updateSettings', resource: user.orgId }, 'Org settings updated');
  json(res, 200, { ok: true, requireSeparateApprover: body.requireSeparateApprover });
}

export async function handleOrgInvite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to invite members' }); return;
  }

  const body = await readJsonBody(req, res);
  if (!body) return;

  if (!body.userId || typeof body.userId !== 'string') {
    json(res, 400, { error: '"userId" is required' }); return;
  }

  const targetUser = await getUser(body.userId as string);
  if (!targetUser) {
    json(res, 404, { error: 'User not found' }); return;
  }

  const role = body.role === 'admin' ? 'admin' : 'member';

  if (role === 'admin' && user.role !== 'owner') {
    json(res, 403, { error: 'Only the org owner can grant admin role' }); return;
  }

  const success = await addOrgMember(user.orgId, targetUser, role);
  if (!success) {
    json(res, 409, { error: 'Cannot add member (org full or already a member)' }); return;
  }

  log.info({ actor: user.id, action: 'org.invite', resource: user.orgId, target: body.userId, role }, 'Member invited to org');
  json(res, 200, { ok: true });
}

export async function handleOrgRemoveMember(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to remove members' }); return;
  }

  const body = await readJsonBody(req, res);
  if (!body) return;

  if (!body.userId || typeof body.userId !== 'string') {
    json(res, 400, { error: '"userId" is required' }); return;
  }

  const success = await removeOrgMember(user.orgId, body.userId as string);
  if (!success) {
    json(res, 409, { error: 'Cannot remove member (owner, not found, or not a member)' }); return;
  }

  log.info({ actor: user.id, action: 'org.removeMember', resource: user.orgId, target: body.userId }, 'Member removed from org');
  json(res, 200, { ok: true });
}

// --- Org invites ---

export async function handleCreateOrgInvite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to create invites' }); return;
  }

  const body = await readJsonBody(req, res);
  if (!body) return;

  if (!body.email || typeof body.email !== 'string' || !(body.email as string).includes('@')) {
    json(res, 400, { error: 'Valid email is required' }); return;
  }

  const role = body.role === 'admin' ? 'admin' : 'member';
  if (role === 'admin' && user.role !== 'owner') {
    json(res, 403, { error: 'Only the org owner can create admin invites' }); return;
  }

  // Limit pending invites to prevent email abuse
  const pendingInvites = await dbListOrgInvites(user.orgId);
  if (pendingInvites.length >= 50) {
    json(res, 429, { error: 'Too many pending invites (max 50). Cancel some before creating new ones.' }); return;
  }

  const invite = await dbCreateOrgInvite({
    id: randomBytes(12).toString('hex'),
    orgId: user.orgId,
    email: (body.email as string).toLowerCase().trim(),
    role,
    token: randomBytes(24).toString('hex'),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    createdBy: user.id,
  });

  // Send invite email
  const org = await getOrg(user.orgId);
  const orgName = org?.name || 'your organization';
  const inviterName = user.name || user.login;
  let emailSent = false;
  try {
    emailSent = await sendOrgInvite(invite.email, orgName, inviterName, invite.role, invite.token);
  } catch (err) {
    log.error({ err, email: invite.email }, 'Failed to send invite email');
  }

  log.info({ actor: user.id, action: 'org.createInvite', resource: user.orgId, email: body.email, emailSent }, 'Org invite created');
  json(res, 201, { invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expires_at }, emailSent });
}

export async function handleListOrgInvites(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to list invites' }); return;
  }

  const invites = await dbListOrgInvites(user.orgId);
  json(res, 200, {
    invites: invites.map(i => ({
      id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at, createdAt: i.created_at,
    })),
  });
}

export async function handleAcceptOrgInvite(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (user.orgId) { json(res, 409, { error: 'Already a member of an organization' }); return; }

  const invite = await dbGetOrgInviteByToken(token);
  if (!invite) { json(res, 404, { error: 'Invite not found or expired' }); return; }

  // Verify the accepting user's email matches the invite
  if (!user.email || user.email.toLowerCase() !== invite.email.toLowerCase()) {
    json(res, 403, { error: 'This invite was sent to a different email address' }); return;
  }

  const success = await addOrgMember(invite.org_id, user, invite.role as 'admin' | 'member');
  if (!success) {
    json(res, 409, { error: 'Cannot join organization (org may be full)' }); return;
  }

  await dbAcceptOrgInvite(invite.id);
  log.info({ actor: user.id, action: 'org.acceptInvite', resource: invite.org_id, invite: invite.id }, 'Org invite accepted');
  json(res, 200, { ok: true, orgId: invite.org_id });
}

export async function handleDeleteOrgInvite(req: IncomingMessage, res: ServerResponse, inviteId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || (user.role !== 'owner' && user.role !== 'admin')) {
    json(res, 403, { error: 'Must be org owner or admin to revoke invites' }); return;
  }

  const ok = await dbDeleteOrgInvite(inviteId, user.orgId);
  if (!ok) { json(res, 404, { error: 'Invite not found' }); return; }
  log.info({ actor: user.id, action: 'org.deleteInvite', resource: inviteId }, 'Org invite revoked');
  json(res, 200, { ok: true });
}

// --- Member role ---

export async function handleUpdateOrgMemberRole(req: IncomingMessage, res: ServerResponse, memberId: string): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId || user.role !== 'owner') {
    json(res, 403, { error: 'Only the org owner can change member roles' }); return;
  }

  const body = await readJsonBody(req, res);
  if (!body) return;

  const role = body.role as string | undefined;
  if (role !== 'admin' && role !== 'member') {
    json(res, 400, { error: 'Role must be "admin" or "member"' }); return;
  }

  if (memberId === user.id) {
    json(res, 409, { error: 'Cannot change your own role' }); return;
  }

  const updated = await dbUpdateOrgMemberRole(user.orgId, memberId, role);
  if (!updated) {
    json(res, 404, { error: 'Member not found in this organization' }); return;
  }

  log.info({ actor: user.id, action: 'org.updateRole', resource: user.orgId, target: memberId, role }, 'Member role updated');
  json(res, 200, { ok: true, userId: memberId, role });
}

// --- Org usage ---

export async function handleGetOrgUsage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  if (!user.orgId) { json(res, 200, { usage: null }); return; }

  const stats = await getUsageStats(user.orgId, 30);
  const monthlyCount = await getMonthlyGenerationCount(user.orgId);
  const members = await getOrgMembers(user.orgId);
  const org = await getOrg(user.orgId);
  const limits = getTeamLimits(org?.maxSeats ?? TEAM_MIN_SEATS);

  json(res, 200, {
    usage: {
      ...stats,
      monthlyGenerations: monthlyCount,
      limits,
      seats: { used: members.length, max: org?.maxSeats || 10 },
    },
  });
}
