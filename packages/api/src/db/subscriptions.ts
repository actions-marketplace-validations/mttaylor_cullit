/** Subscription DB operations (Stripe billing state). */

import { sql } from './client.js';

export async function dbUpsertSubscription(sub: {
  id: string; userId: string; stripeSubscriptionId: string; stripeCustomerId: string;
  plan: string; status: string;
  currentPeriodStart?: Date; currentPeriodEnd?: Date; cancelAtPeriodEnd?: boolean;
}): Promise<void> {
  await sql`
    INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_customer_id, plan, status,
      current_period_start, current_period_end, cancel_at_period_end)
    VALUES (${sub.id}, ${sub.userId}, ${sub.stripeSubscriptionId}, ${sub.stripeCustomerId},
            ${sub.plan}, ${sub.status},
            ${sub.currentPeriodStart || null}, ${sub.currentPeriodEnd || null}, ${sub.cancelAtPeriodEnd || false})
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = NOW()
  `;
}

export async function dbGetSubscription(userId: string): Promise<{
  id: string; plan: string; status: string;
  stripe_subscription_id: string; stripe_customer_id: string;
  current_period_start: Date | null; current_period_end: Date | null;
  cancel_at_period_end: boolean;
} | null> {
  if (!sql) return null;
  const rows = await sql<{
    id: string; plan: string; status: string;
    stripe_subscription_id: string; stripe_customer_id: string;
    current_period_start: Date | null; current_period_end: Date | null;
    cancel_at_period_end: boolean;
  }[]>`
    SELECT * FROM subscriptions
    WHERE user_id = ${userId} AND status IN ('active', 'trialing', 'past_due')
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0] || null;
}
