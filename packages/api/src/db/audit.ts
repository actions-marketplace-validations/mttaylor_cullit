/** Audit event tracking for security-sensitive operations. */

import { sql } from './client.js';
import { log } from '../logger.js';

export async function dbRecordAuditEvent(event: {
  userId?: string | null; action: string; target?: string | null;
  metadata?: Record<string, unknown> | null; ip?: string | null;
}): Promise<void> {
  if (!sql) return;
  const id = `ae_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await sql`
    INSERT INTO audit_events (id, user_id, action, target, metadata, ip)
    VALUES (${id}, ${event.userId || null}, ${event.action}, ${event.target || null},
            ${event.metadata ? JSON.stringify(event.metadata) : null}::jsonb, ${event.ip || null})
  `.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to record audit event'); });
}

export async function dbGetAuditEvents(userId: string, limit: number, offset: number): Promise<{
  events: { id: string; action: string; target: string | null; metadata: Record<string, unknown> | null; ip: string | null; created_at: string }[];
  total: number;
}> {
  if (!sql) return { events: [], total: 0 };
  const countRows = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM audit_events WHERE user_id = ${userId}`;
  const total = parseInt(countRows[0].count, 10);
  const rows = await sql<{ id: string; action: string; target: string | null; metadata: Record<string, unknown> | null; ip: string | null; created_at: Date }[]>`
    SELECT id, action, target, metadata, ip, created_at FROM audit_events
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return {
    events: rows.map(r => ({ ...r, created_at: r.created_at.toISOString() })),
    total,
  };
}
