/** Stripe webhook idempotency tracking. */

import { sql } from './client.js';

export async function dbCheckWebhookProcessed(eventId: string): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql`SELECT 1 FROM webhook_events WHERE stripe_event_id = ${eventId}`;
  return rows.length > 0;
}

/**
 * Atomic claim: inserts a row for this event ID. Returns true if WE inserted
 * (i.e. own this event), false if another worker already claimed it.
 */
export async function dbMarkWebhookProcessed(eventId: string, eventType: string): Promise<boolean> {
  if (!sql) return true;
  const rows = await sql`
    INSERT INTO webhook_events (stripe_event_id, event_type)
    VALUES (${eventId}, ${eventType})
    ON CONFLICT (stripe_event_id) DO NOTHING
    RETURNING stripe_event_id
  `;
  return rows.length > 0;
}

/**
 * Release a previously-claimed webhook so Stripe's retry can re-claim it
 * after a processing failure.
 */
export async function dbUnmarkWebhookProcessed(eventId: string): Promise<void> {
  if (!sql) return;
  await sql`DELETE FROM webhook_events WHERE stripe_event_id = ${eventId}`;
}
