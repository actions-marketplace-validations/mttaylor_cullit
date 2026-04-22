/** OAuth state (DB-backed CSRF protection, survives restarts). */

import { sql } from './client.js';

export async function dbCreateOAuthState(state: string, returnTo: string): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO oauth_states (state, return_to) VALUES (${state}, ${returnTo})
    ON CONFLICT (state) DO NOTHING
  `;
}

/**
 * Atomically consume an OAuth state row and return its returnTo value.
 * Returns null if the state doesn't exist or has expired (>10 min old).
 */
export async function dbConsumeOAuthState(state: string): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql<[{ return_to: string | null }]>`
    DELETE FROM oauth_states
    WHERE state = ${state} AND created_at > NOW() - INTERVAL '10 minutes'
    RETURNING return_to
  `;
  if (rows.length === 0) return null;
  return rows[0].return_to || '';
}
