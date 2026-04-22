/**
 * Data retention cleanup. Honors TERMS.md/PRIVACY.md retention policy.
 * Deletes:
 *   - generations older than 90 days
 *   - audit_events older than 365 days
 *   - revoked team_api_keys older than 90 days
 *   - email_throttle entries older than 1 day
 *   - oauth_states older than 1 hour
 * Safe to call repeatedly. No-op when DB is not configured.
 */

import { sql } from './client.js';
import { log } from '../logger.js';

export async function dbRunRetentionCleanup(): Promise<{ generations: number; auditEvents: number; teamKeys: number }> {
  if (!sql) return { generations: 0, auditEvents: 0, teamKeys: 0 };
  let generations = 0, auditEvents = 0, teamKeys = 0;
  try {
    const g = await sql`DELETE FROM generations WHERE created_at < NOW() - INTERVAL '90 days' RETURNING id`;
    generations = g.length;
  } catch (err) { log.warn({ err: (err as Error).message }, 'retention: generations cleanup failed'); }
  try {
    const a = await sql`DELETE FROM audit_events WHERE created_at < NOW() - INTERVAL '365 days' RETURNING id`;
    auditEvents = a.length;
  } catch (err) { log.warn({ err: (err as Error).message }, 'retention: audit_events cleanup failed'); }
  try {
    const k = await sql`DELETE FROM team_api_keys WHERE revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '90 days' RETURNING id`;
    teamKeys = k.length;
  } catch (err) { log.warn({ err: (err as Error).message }, 'retention: team_api_keys cleanup failed'); }
  await sql`DELETE FROM email_throttle WHERE sent_at < NOW() - INTERVAL '1 day'`.catch(() => {});
  await sql`DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '1 hour'`.catch(() => {});
  log.info({ generations, auditEvents, teamKeys }, 'Retention cleanup completed');
  return { generations, auditEvents, teamKeys };
}
