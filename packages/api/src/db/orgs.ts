/** Org, org-member, and org-invite DB operations. */

import { sql } from './client.js';
import type { DbUser } from './users.js';

export interface DbOrg {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  tier: string;
  max_seats: number;
  require_separate_approver: boolean;
  created_at: Date;
}

export interface DbOrgInvite {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_by: string;
  created_at: Date;
}

// --- Orgs ---

export async function dbGetOrg(id: string): Promise<DbOrg | null> {
  const rows = await sql<DbOrg[]>`SELECT * FROM orgs WHERE id = ${id}`;
  return rows[0] || null;
}

export async function dbGetOrgBySlug(slug: string): Promise<DbOrg | null> {
  const rows = await sql<DbOrg[]>`SELECT * FROM orgs WHERE slug = ${slug}`;
  return rows[0] || null;
}

export async function dbGetOrgCountForOwner(userId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`SELECT COUNT(*)::text AS count FROM orgs WHERE owner_id = ${userId}`;
  return parseInt(rows[0].count, 10);
}

export async function dbGetOrgsOwnedByUser(userId: string): Promise<DbOrg[]> {
  return sql<DbOrg[]>`SELECT * FROM orgs WHERE owner_id = ${userId}`;
}

export async function dbCreateOrg(org: { id: string; name: string; slug: string; ownerId: string; tier: string; maxSeats: number }): Promise<DbOrg> {
  const rows = await sql<DbOrg[]>`
    INSERT INTO orgs (id, name, slug, owner_id, tier, max_seats)
    VALUES (${org.id}, ${org.name}, ${org.slug}, ${org.ownerId}, ${org.tier}, ${org.maxSeats})
    ON CONFLICT (slug) DO NOTHING
    RETURNING *
  `;
  return rows[0];
}

export async function dbUpdateOrgSettings(orgId: string, settings: { requireSeparateApprover: boolean }): Promise<void> {
  await sql`UPDATE orgs SET require_separate_approver = ${settings.requireSeparateApprover} WHERE id = ${orgId}`;
}

export async function dbUpdateOrgMaxSeats(orgId: string, maxSeats: number): Promise<void> {
  await sql`UPDATE orgs SET max_seats = ${maxSeats} WHERE id = ${orgId}`;
}

// --- Members ---

export async function dbGetOrgMemberCount(orgId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`SELECT COUNT(*)::text AS count FROM org_members WHERE org_id = ${orgId}`;
  return parseInt(rows[0].count, 10);
}

export async function dbAddOrgMember(orgId: string, userId: string, role: string): Promise<boolean> {
  try {
    await sql`INSERT INTO org_members (org_id, user_id, role) VALUES (${orgId}, ${userId}, ${role})`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically add org member only if seat count is below max.
 * Prevents race condition where two concurrent invites both pass the seat check.
 */
export async function dbAddOrgMemberAtomic(orgId: string, userId: string, role: string, maxSeats: number): Promise<boolean> {
  try {
    const result = await sql.begin(async (tx: any) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;
      return tx`
        INSERT INTO org_members (org_id, user_id, role)
        SELECT ${orgId}, ${userId}, ${role}
        WHERE (SELECT COUNT(*) FROM org_members WHERE org_id = ${orgId}) < ${maxSeats}
      `;
    });
    return result.count > 0;
  } catch {
    return false;
  }
}

export async function dbRemoveOrgMember(orgId: string, userId: string): Promise<boolean> {
  const result = await sql`DELETE FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`;
  return result.count > 0;
}

export async function dbGetOrgMembers(orgId: string): Promise<DbUser[]> {
  return sql<DbUser[]>`
    SELECT u.* FROM users u
    JOIN org_members om ON u.id = om.user_id
    WHERE om.org_id = ${orgId}
    ORDER BY om.joined_at
    LIMIT 500
  `;
}

export async function dbUpdateOrgMemberRole(orgId: string, userId: string, role: string): Promise<boolean> {
  const result = await sql`
    UPDATE org_members SET role = ${role}
    WHERE org_id = ${orgId} AND user_id = ${userId}
  `;
  if (result.count === 0) return false;
  await sql`UPDATE users SET role = ${role} WHERE id = ${userId} AND org_id = ${orgId}`;
  return true;
}

// --- Invites ---

export async function dbCreateOrgInvite(invite: {
  id: string; orgId: string; email: string; role: string; token: string; expiresAt: Date; createdBy: string;
}): Promise<DbOrgInvite> {
  const rows = await sql<DbOrgInvite[]>`
    INSERT INTO org_invites (id, org_id, email, role, token, expires_at, created_by)
    VALUES (${invite.id}, ${invite.orgId}, ${invite.email}, ${invite.role}, ${invite.token}, ${invite.expiresAt}, ${invite.createdBy})
    RETURNING *
  `;
  return rows[0];
}

export async function dbListOrgInvites(orgId: string): Promise<DbOrgInvite[]> {
  return sql<DbOrgInvite[]>`
    SELECT * FROM org_invites WHERE org_id = ${orgId} AND accepted_at IS NULL AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
}

export async function dbGetOrgInviteByToken(token: string): Promise<DbOrgInvite | null> {
  const rows = await sql<DbOrgInvite[]>`
    SELECT * FROM org_invites WHERE token = ${token} AND accepted_at IS NULL AND expires_at > NOW()`;
  return rows[0] || null;
}

export async function dbAcceptOrgInvite(id: string): Promise<boolean> {
  const result = await sql`UPDATE org_invites SET accepted_at = NOW() WHERE id = ${id}`;
  return result.count > 0;
}

export async function dbDeleteOrgInvite(id: string, orgId?: string): Promise<boolean> {
  const result = orgId
    ? await sql`DELETE FROM org_invites WHERE id = ${id} AND org_id = ${orgId}`
    : await sql`DELETE FROM org_invites WHERE id = ${id}`;
  return result.count > 0;
}
