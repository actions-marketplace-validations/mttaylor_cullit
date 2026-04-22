/** Team API key DB operations (seat-based keys for org members). */

import { sql, hashApiKey } from './client.js';

export interface DbTeamApiKey {
  id: string;
  org_id: string;
  api_key: string;
  label: string;
  assigned_to_email: string | null;
  assigned_to_name: string | null;
  assigned_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export async function dbCreateTeamApiKey(key: {
  id: string; orgId: string; apiKey: string; label: string;
}): Promise<DbTeamApiKey> {
  const keyHash = hashApiKey(key.apiKey);
  const rows = await sql<DbTeamApiKey[]>`
    INSERT INTO team_api_keys (id, org_id, api_key, api_key_hash, label)
    VALUES (${key.id}, ${key.orgId}, ${key.apiKey}, ${keyHash}, ${key.label})
    RETURNING *
  `;
  return rows[0];
}

export async function dbGetTeamApiKeys(orgId: string): Promise<DbTeamApiKey[]> {
  return sql<DbTeamApiKey[]>`
    SELECT * FROM team_api_keys WHERE org_id = ${orgId} ORDER BY created_at
  `;
}

export async function dbGetActiveTeamApiKeyCount(orgId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM team_api_keys WHERE org_id = ${orgId} AND revoked_at IS NULL
  `;
  return parseInt(rows[0].count, 10);
}

export async function dbGetTeamApiKeyByKey(apiKey: string): Promise<DbTeamApiKey | null> {
  const keyHash = hashApiKey(apiKey);
  const rows = await sql<DbTeamApiKey[]>`
    SELECT * FROM team_api_keys WHERE api_key_hash = ${keyHash} AND revoked_at IS NULL
  `;
  return rows[0] || null;
}

export async function dbUpdateTeamApiKeyAssignment(
  id: string, orgId: string, email: string | null, name: string | null,
): Promise<DbTeamApiKey | null> {
  const rows = await sql<DbTeamApiKey[]>`
    UPDATE team_api_keys
    SET assigned_to_email = ${email}, assigned_to_name = ${name},
        assigned_at = ${email ? sql`NOW()` : null}
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING *
  `;
  return rows[0] || null;
}

export async function dbUpdateTeamApiKeyLabel(
  id: string, orgId: string, label: string,
): Promise<DbTeamApiKey | null> {
  const rows = await sql<DbTeamApiKey[]>`
    UPDATE team_api_keys SET label = ${label} WHERE id = ${id} AND org_id = ${orgId} RETURNING *
  `;
  return rows[0] || null;
}

export async function dbRevokeTeamApiKey(id: string, orgId: string): Promise<boolean> {
  const result = await sql`
    UPDATE team_api_keys SET revoked_at = NOW() WHERE id = ${id} AND org_id = ${orgId} AND revoked_at IS NULL
  `;
  return result.count > 0;
}

export async function dbRevokeAllOrgTeamApiKeys(orgId: string): Promise<number> {
  const result = await sql`
    UPDATE team_api_keys SET revoked_at = NOW() WHERE org_id = ${orgId} AND revoked_at IS NULL
  `;
  return result.count;
}

export async function dbRevokeExcessTeamApiKeys(orgId: string, maxActive: number): Promise<number> {
  const result = await sql`
    UPDATE team_api_keys SET revoked_at = NOW()
    WHERE id IN (
      SELECT id FROM team_api_keys
      WHERE org_id = ${orgId} AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT (
        SELECT GREATEST(0, COUNT(*) - ${maxActive})
        FROM team_api_keys WHERE org_id = ${orgId} AND revoked_at IS NULL
      )
    )
  `;
  return result.count;
}

export async function dbRotateTeamApiKey(id: string, orgId: string, newApiKey: string): Promise<DbTeamApiKey | null> {
  const rows = await sql<DbTeamApiKey[]>`
    UPDATE team_api_keys SET api_key = ${newApiKey}, api_key_hash = ${hashApiKey(newApiKey)} WHERE id = ${id} AND org_id = ${orgId} AND revoked_at IS NULL RETURNING *
  `;
  return rows[0] || null;
}
