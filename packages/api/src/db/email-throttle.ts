/** Email throttle (DB-backed, survives restarts and multi-replica deployments). */

import { sql } from './client.js';

export async function dbCountRecentEmails(recipient: string, windowMs: number): Promise<number> {
  if (!sql) return 0;
  const seconds = Math.ceil(windowMs / 1000);
  const rows = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM email_throttle
    WHERE recipient = ${recipient} AND sent_at > NOW() - (${seconds} || ' seconds')::interval
  `;
  return parseInt(rows[0].count, 10);
}

export async function dbRecordEmailSent(recipient: string): Promise<void> {
  if (!sql) return;
  await sql`INSERT INTO email_throttle (recipient) VALUES (${recipient})`;
}
