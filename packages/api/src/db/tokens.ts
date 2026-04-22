/** JWT token revocation (blacklist for logged-out / rotated tokens). */

import { sql } from './client.js';

export async function dbRevokeToken(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO revoked_tokens (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, ${expiresAt})
    ON CONFLICT (token_hash) DO NOTHING
  `;
}

export async function dbIsTokenRevoked(tokenHash: string): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql`SELECT 1 FROM revoked_tokens WHERE token_hash = ${tokenHash}`;
  return rows.length > 0;
}

export async function dbRevokeAllUserTokens(userId: string): Promise<void> {
  if (!sql) return;
  await sql`UPDATE users SET tokens_revoked_before = NOW() WHERE id = ${userId}`;
}

export async function dbGetTokensRevokedBefore(userId: string): Promise<Date | null> {
  if (!sql) return null;
  const rows = await sql<{ tokens_revoked_before: Date | null }[]>`SELECT tokens_revoked_before FROM users WHERE id = ${userId}`;
  return rows[0]?.tokens_revoked_before || null;
}
