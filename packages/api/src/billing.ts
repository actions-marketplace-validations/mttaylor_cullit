/**
 * Cullit Stripe Billing
 *
 * Handles:
 *   - Checkout session creation (Basic / Pro / Team 5/10/25 plans)
 *   - Webhook processing (subscription lifecycle)
 *   - Customer portal sessions
 *   - Tier sync (Stripe status → user tier in DB)
 *   - Team API key provisioning and lifecycle (create on checkout, revoke on cancel/downgrade)
 *
 * Environment Variables:
 *   STRIPE_SECRET_KEY            — Stripe API secret key (sk_test_... or sk_live_...)
 *   STRIPE_WEBHOOK_SECRET        — Webhook endpoint signing secret (whsec_...)
 *   STRIPE_PRO_PRICE_ID          — Price ID for Pro plan ($9/mo)
 *   STRIPE_TEAM_5_PRICE_ID       — Price ID for Team 5 plan ($44.99/mo, 5 seats)
 *   STRIPE_TEAM_10_PRICE_ID      — Price ID for Team 10 plan ($89/mo, 10 seats)
 *   STRIPE_TEAM_25_PRICE_ID      — Price ID for Team 25 plan ($209/mo, 25 seats)
 *   CULLIT_BASE_URL              — Public base URL for success/cancel redirects
 *
 * NOTE: We use Stripe's REST API directly instead of the SDK
 * to maintain our zero external runtime dependency principle
 * (postgres is the only runtime dep).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  sql,
  dbGetUser, dbUpdateUserTier, dbUpdateUserStripe,
  dbUpsertSubscription, dbGetSubscription, dbGetUserByStripeCustomer,
  dbCheckWebhookProcessed, dbMarkWebhookProcessed,
  dbCreateTeamApiKey, dbGetActiveTeamApiKeyCount,
  dbRevokeAllOrgTeamApiKeys, dbRevokeExcessTeamApiKeys,
  hashApiKey, dbRecordAuditEvent,
} from './db.js';
import { getEffectiveTier, getUser, generateApiKey } from './auth.js';
import { createOrg } from './auth.js';
import { isRecord } from './utils.js';
import { log } from './logger.js';
import { sendPaymentFailed, sendSubscriptionConfirmed } from './email.js';
import { TEAM_PLAN_SEATS } from '@cullit/core';

const STRIPE_SECRET_KEY = process.env['STRIPE_SECRET_KEY'] || '';
const STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] || '';
const STRIPE_BASIC_PRICE_ID = process.env['STRIPE_BASIC_PRICE_ID'] || '';
const STRIPE_PRO_PRICE_ID = process.env['STRIPE_PRO_PRICE_ID'] || '';
const STRIPE_TEAM_PRICE_ID = process.env['STRIPE_TEAM_PRICE_ID'] || '';
const STRIPE_TEAM_5_PRICE_ID = process.env['STRIPE_TEAM_5_PRICE_ID'] || STRIPE_TEAM_PRICE_ID;
const STRIPE_TEAM_10_PRICE_ID = process.env['STRIPE_TEAM_10_PRICE_ID'] || '';
const STRIPE_TEAM_25_PRICE_ID = process.env['STRIPE_TEAM_25_PRICE_ID'] || '';

if (STRIPE_SECRET_KEY) {
  if (!STRIPE_BASIC_PRICE_ID) log.warn('STRIPE_BASIC_PRICE_ID not set — Basic checkout will fail');
  if (!STRIPE_PRO_PRICE_ID) log.warn('STRIPE_PRO_PRICE_ID not set — Pro checkout will fail');
  if (!STRIPE_TEAM_5_PRICE_ID) log.warn('STRIPE_TEAM_5_PRICE_ID not set — Team 5 checkout will fail');
  if (!STRIPE_TEAM_10_PRICE_ID) log.warn('STRIPE_TEAM_10_PRICE_ID not set — Team 10 checkout will fail');
  if (!STRIPE_TEAM_25_PRICE_ID) log.warn('STRIPE_TEAM_25_PRICE_ID not set — Team 25 checkout will fail');
}
const BASE_URL = process.env['CULLIT_BASE_URL'] || 'http://localhost:3000';
const DASHBOARD_URL = process.env['CULLIT_DASHBOARD_URL'] || BASE_URL;

// --- Webhook idempotency ---
// DB-backed via webhook_events table (survives restarts).
// In-memory Set kept as a fast-path cache to avoid DB round-trip on hot duplicates.

const MAX_PROCESSED_EVENTS = 1000;
const processedWebhookEvents = new Set<string>();
const processedOrder: string[] = [];

function markInMemory(eventId: string): void {
  processedWebhookEvents.add(eventId);
  processedOrder.push(eventId);
  while (processedOrder.length > MAX_PROCESSED_EVENTS) {
    const oldest = processedOrder.shift()!;
    processedWebhookEvents.delete(oldest);
  }
}

async function isWebhookProcessed(eventId: string): Promise<boolean> {
  if (processedWebhookEvents.has(eventId)) return true;
  return dbCheckWebhookProcessed(eventId);
}

async function markWebhookProcessed(eventId: string, eventType: string): Promise<void> {
  markInMemory(eventId);
  await dbMarkWebhookProcessed(eventId, eventType);
}

// --- Stripe API helpers ---

interface StripeErrorResponse {
  error?: { message?: string };
}

interface StripeEvent {
  id: string;
  type: string;
  data?: { object?: unknown };
}

interface StripeCheckoutSession {
  client_reference_id?: string;
  metadata?: { user_id?: string; plan?: string };
  customer?: string;
  subscription?: string;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  items?: { data?: Array<{ id?: string; price?: { id?: string } }> };
}

interface StripeInvoice {
  id?: string;
  customer: string;
  subscription?: string;
}

// isRecord imported from utils.ts

function toStripeEvent(value: unknown): StripeEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.id !== 'string') return null;
  const data = isRecord(value.data) ? value.data : undefined;
  const object = data && 'object' in data ? data.object : undefined;
  return { id: value.id, type: value.type, data: { object } };
}

function toStripeCheckoutSession(value: unknown): StripeCheckoutSession | null {
  if (!isRecord(value)) return null;
  return {
    client_reference_id: typeof value.client_reference_id === 'string' ? value.client_reference_id : undefined,
    metadata: isRecord(value.metadata)
      ? {
          user_id: typeof value.metadata.user_id === 'string' ? value.metadata.user_id : undefined,
          plan: typeof value.metadata.plan === 'string' ? value.metadata.plan : undefined,
        }
      : undefined,
    customer: typeof value.customer === 'string' ? value.customer : undefined,
    subscription: typeof value.subscription === 'string' ? value.subscription : undefined,
  };
}

function toStripeSubscription(value: unknown): StripeSubscription | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.customer !== 'string') {
    return null;
  }

  const items = isRecord(value.items) && Array.isArray(value.items.data)
    ? { data: value.items.data.filter(isRecord).map(item => ({ id: typeof item.id === 'string' ? item.id : undefined, price: isRecord(item.price) ? { id: typeof item.price.id === 'string' ? item.price.id : undefined } : undefined })) }
    : undefined;

  return {
    id: value.id,
    customer: value.customer,
    status: typeof value.status === 'string' ? value.status : 'active',
    current_period_start: typeof value.current_period_start === 'number' ? value.current_period_start : undefined,
    current_period_end: typeof value.current_period_end === 'number' ? value.current_period_end : undefined,
    cancel_at_period_end: typeof value.cancel_at_period_end === 'boolean' ? value.cancel_at_period_end : undefined,
    items,
  };
}

function toStripeInvoice(value: unknown): StripeInvoice | null {
  if (!isRecord(value) || typeof value.customer !== 'string') return null;
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    customer: value.customer,
    subscription: typeof value.subscription === 'string' ? value.subscription : undefined,
  };
}

async function stripeRequest<T>(path: string, method: string, body?: Record<string, string>): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const data = await res.json() as StripeErrorResponse & T;
  if (!res.ok) {
    throw new Error(`Stripe API error: ${data.error?.message || res.statusText}`);
  }
  return data;
}

// --- Webhook signature verification ---

export function verifyWebhookSignature(payload: string, sigHeader: string): boolean {
  if (!STRIPE_WEBHOOK_SECRET) return false;

  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    if (key === 't') acc.timestamp = value;
    if (key === 'v1') acc.signatures.push(value);
    return acc;
  }, { timestamp: '', signatures: [] as string[] });

  if (!parts.timestamp || parts.signatures.length === 0) return false;

  // Reject timestamps too far in the past or future (5 minute tolerance)
  const now = Date.now() / 1000;
  const ts = parseInt(parts.timestamp, 10);
  if (isNaN(ts) || ts > now + 300 || ts < now - 300) return false;

  const expected = createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(`${parts.timestamp}.${payload}`)
    .digest('hex');

  return parts.signatures.some(sig => {
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return false;
    }
  });
}

// --- Plan mapping (exported for testing) ---

export function priceToPlan(priceId: string): string {
  if (priceId === STRIPE_BASIC_PRICE_ID) return 'basic';
  if (priceId === STRIPE_PRO_PRICE_ID) return 'pro';
  if (priceId === STRIPE_TEAM_5_PRICE_ID) return 'team-5';
  if (priceId === STRIPE_TEAM_10_PRICE_ID) return 'team-10';
  if (priceId === STRIPE_TEAM_25_PRICE_ID) return 'team-25';
  if (priceId === STRIPE_TEAM_PRICE_ID) return 'team-5'; // legacy fallback
  return 'free';
}

export function planToTier(plan: string): string {
  if (plan === 'basic') return 'basic';
  if (plan === 'pro') return 'pro';
  if (plan === 'team' || plan.startsWith('team-')) return 'team';
  return 'free';
}

export function planToSeats(plan: string): number {
  const seats = TEAM_PLAN_SEATS[plan as keyof typeof TEAM_PLAN_SEATS];
  return seats || 0;
}

/** Build a subscription record for dbUpsertSubscription, eliminating repetition across webhook handlers. */
function buildSubscriptionRecord(
  subscriptionId: string,
  userId: string,
  customerId: string,
  plan: string,
  sub?: StripeSubscription | null,
  overrides?: { status?: string },
) {
  return {
    id: subscriptionId,
    userId,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerId,
    plan,
    status: overrides?.status || sub?.status || 'active',
    currentPeriodStart: sub?.current_period_start ? new Date(sub.current_period_start * 1000) : undefined,
    currentPeriodEnd: sub?.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
    cancelAtPeriodEnd: sub?.cancel_at_period_end || false,
  };
}

// --- Checkout ---

export async function handleCheckout(
  userId: string,
  plan: 'basic' | 'pro' | 'team-5' | 'team-10' | 'team-25',
  jsonFn: (res: ServerResponse, status: number, body: unknown) => void,
  res: ServerResponse,
): Promise<void> {
  if (!STRIPE_SECRET_KEY) {
    jsonFn(res, 503, { error: 'Billing is not configured' });
    return;
  }

  const user = await dbGetUser(userId);
  if (!user) {
    jsonFn(res, 404, { error: 'User not found' });
    return;
  }

  const priceId = plan === 'team-25' ? STRIPE_TEAM_25_PRICE_ID
    : plan === 'team-10' ? STRIPE_TEAM_10_PRICE_ID
    : plan === 'team-5' ? STRIPE_TEAM_5_PRICE_ID
    : plan === 'basic' ? STRIPE_BASIC_PRICE_ID
    : STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    jsonFn(res, 503, { error: `Price not configured for ${plan} plan` });
    return;
  }

  // If user already has an active subscription, update it instead of creating a new one
  const existingSub = await dbGetSubscription(userId);
  if (existingSub && existingSub.stripe_subscription_id && existingSub.status === 'active') {
    try {
      // Fetch the subscription to get the current item ID
      const sub = await stripeRequest<StripeSubscription>(`/subscriptions/${existingSub.stripe_subscription_id}`, 'GET');
      const itemId = sub.items?.data?.[0]?.id;
      if (itemId) {
        // Update the subscription in-place: swap price, prorate immediately
        // Idempotency key prevents duplicate charges on network retry
        const idempotencyKey = `sub_update_${userId}_${plan}_${existingSub.stripe_subscription_id}`;
        await stripeRequest(`/subscriptions/${existingSub.stripe_subscription_id}`, 'POST', {
          'items[0][id]': itemId,
          'items[0][price]': priceId,
          'proration_behavior': 'create_prorations',
          'metadata[plan]': plan,
          'Idempotency-Key': idempotencyKey,
        });

        // Update tier immediately — webhook will also fire as confirmation
        const tier = planToTier(plan);
        await dbUpdateUserTier(userId, tier);

        log.info({ userId, plan, subscriptionId: existingSub.stripe_subscription_id }, 'Subscription updated (plan change)');
        jsonFn(res, 200, { updated: true, plan });
        return;
      }
    } catch (err) {
      log.error({ err, userId, plan, subscriptionId: existingSub.stripe_subscription_id }, 'Failed to update existing subscription');
      jsonFn(res, 502, { error: 'Failed to update subscription. Please try again or contact support.' });
      return;
    }
  }

  // Idempotency key prevents duplicate checkout sessions on network retry
  const idempotencyKey = `checkout_${userId}_${plan}_${Math.floor(Date.now() / 60_000)}`;
  const params: Record<string, string> = {
    'mode': 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': `${DASHBOARD_URL}/dashboard.html?billing=success`,
    'cancel_url': `${DASHBOARD_URL}/dashboard.html?billing=cancelled`,
    'client_reference_id': userId,
    'metadata[user_id]': userId,
    'metadata[plan]': plan,
    'Idempotency-Key': idempotencyKey,
  };

  // If user already has a Stripe customer ID, reuse it
  if (user.stripe_customer_id) {
    params['customer'] = user.stripe_customer_id;
  } else if (user.email) {
    params['customer_email'] = user.email;
  }

  try {
    const session = await stripeRequest<{ url?: string }>('/checkout/sessions', 'POST', params);
    if (!session.url) {
      log.error({ plan, userId }, 'Stripe returned checkout session without URL');
      jsonFn(res, 502, { error: 'Checkout session could not be created. Please try again.' });
      return;
    }
    jsonFn(res, 200, { url: session.url });
  } catch (err) {
    log.error({ err, plan, userId }, 'Stripe checkout session creation failed');
    jsonFn(res, 502, { error: 'Payment service is temporarily unavailable. Please try again shortly.' });
  }
}

// --- Customer Portal ---

export async function handleBillingPortal(
  userId: string,
  jsonFn: (res: ServerResponse, status: number, body: unknown) => void,
  res: ServerResponse,
): Promise<void> {
  if (!STRIPE_SECRET_KEY) {
    jsonFn(res, 503, { error: 'Billing is not configured' });
    return;
  }

  const user = await dbGetUser(userId);
  if (!user?.stripe_customer_id) {
    jsonFn(res, 400, { error: 'No billing account found. Subscribe to a plan first.' });
    return;
  }

  try {
    const session = await stripeRequest<{ url?: string }>('/billing_portal/sessions', 'POST', {
      'customer': user.stripe_customer_id,
      'return_url': `${DASHBOARD_URL}/dashboard.html?billing=updated`,
    });
    if (!session.url) {
      log.error({ userId }, 'Stripe returned portal session without URL');
      jsonFn(res, 502, { error: 'Billing portal could not be opened. Please try again.' });
      return;
    }
    jsonFn(res, 200, { url: session.url });
  } catch (err) {
    log.error({ err, userId }, 'Stripe billing portal session creation failed');
    jsonFn(res, 502, { error: 'Payment service is temporarily unavailable. Please try again shortly.' });
  }
}

// --- Get subscription status ---

export async function handleGetSubscription(
  userId: string,
  jsonFn: (res: ServerResponse, status: number, body: unknown) => void,
  res: ServerResponse,
): Promise<void> {
  const user = await getUser(userId);
  if (!user) {
    jsonFn(res, 404, { error: 'User not found' });
    return;
  }
  const effectiveTier = getEffectiveTier(user);
  const sub = await dbGetSubscription(userId);
  if (!sub) {
    jsonFn(res, 200, { subscription: null, plan: effectiveTier, tier: user.tier || 'free', effectiveTier });
    return;
  }

  jsonFn(res, 200, {
    subscription: {
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
    plan: sub.plan,
    tier: user.tier || sub.plan,
    effectiveTier,
  });
}

// --- Webhook handler ---

export async function handleStripeWebhook(
  req: IncomingMessage,
  rawBody: string,
  jsonFn: (res: ServerResponse, status: number, body: unknown) => void,
  res: ServerResponse,
): Promise<void> {
  const sigHeader = req.headers['stripe-signature'] as string || '';

  if (!verifyWebhookSignature(rawBody, sigHeader)) {
    jsonFn(res, 400, { error: 'Invalid webhook signature' });
    return;
  }

  let event: StripeEvent;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    const normalized = toStripeEvent(parsed);
    if (!normalized) {
      jsonFn(res, 400, { error: 'Invalid Stripe event payload' });
      return;
    }
    event = normalized;
  } catch {
    jsonFn(res, 400, { error: 'Invalid JSON' });
    return;
  }

  // Idempotency: skip already-processed events (DB-backed + in-memory cache)
  if (await isWebhookProcessed(event.id)) {
    jsonFn(res, 200, { received: true, duplicate: true });
    return;
  }

  try {
    // Mark processed BEFORE handling to close the race window where a duplicate
    // webhook could slip through during processing. If handling fails, the
    // catch block returns 500 so Stripe will retry (and the idempotent handler
    // will silently skip the already-processed event).
    await markWebhookProcessed(event.id, event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data?.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data?.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data?.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data?.object);
        break;
    }

    jsonFn(res, 200, { received: true });
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Stripe webhook error');
    jsonFn(res, 500, { error: 'Webhook processing failed' });
  }
}

async function handleCheckoutComplete(sessionPayload: unknown): Promise<void> {
  const session = toStripeCheckoutSession(sessionPayload);
  if (!session) return;

  const userId = session.client_reference_id || session.metadata?.user_id;
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const plan = session.metadata?.plan || 'pro';

  if (!userId || !customerId || !subscriptionId) {
    log.warn({ userId, customerId, subscriptionId }, 'Checkout session missing required fields — skipping');
    return;
  }

  // Link Stripe customer to user
  await dbUpdateUserStripe(userId, customerId, subscriptionId);

  // Update user tier
  const tier = planToTier(plan);
  await dbUpdateUserTier(userId, tier);

  // Fetch full subscription details from Stripe
  const sub = await stripeRequest<StripeSubscription>(`/subscriptions/${subscriptionId}`, 'GET');

  await dbUpsertSubscription(buildSubscriptionRecord(subscriptionId, userId, customerId, plan, sub));

  log.info({ userId, plan, customerId }, 'Checkout complete');

  // Provision team API keys if this is a team plan
  const seats = planToSeats(plan);
  if (seats > 0) {
    // Retry up to 3 times — user was already charged, keys MUST be provisioned
    let attempt = 0;
    let provisioned = false;
    while (attempt < 3) {
      try {
        await provisionTeamKeys(userId, plan, seats);
        provisioned = true;
        break;
      } catch (err) {
        attempt++;
        if (attempt < 3) {
          log.warn({ err: (err as Error).message, userId, plan, seats, attempt }, `Team key provisioning attempt ${attempt} failed, retrying...`);
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }

    if (!provisioned) {
      log.error({ userId, plan, seats }, 'Failed to provision team API keys after 3 attempts — recording for recovery');
      // Record audit event so the failure is durable and queryable for recovery
      await dbRecordAuditEvent({
        userId, action: 'team_key_provisioning_failed',
        target: subscriptionId,
        metadata: { plan, seats, attempts: 3 },
      });
      // Schedule one final async retry after 30s — last chance before manual intervention
      setTimeout(async () => {
        try {
          await provisionTeamKeys(userId, plan, seats);
          log.info({ userId, plan, seats }, 'Deferred team key provisioning succeeded');
        } catch (err) {
          log.error({ err: (err as Error).message, userId, plan, seats }, 'Deferred team key provisioning also failed — manual intervention required');
        }
      }, 30_000);
    }
  }

  // Send subscription confirmation email (no plaintext key — user views key in dashboard)
  const user = await dbGetUser(userId);
  if (user?.email) {
    try {
      await sendSubscriptionConfirmed(user.email, user.name || user.login, plan);
    } catch (err) {
      log.error({ err: (err as Error).message, userId }, 'Failed to send subscription confirmed email — user was charged but did not receive confirmation');
    }
  }
}

/**
 * Provision team API keys after a team plan checkout or upgrade.
 * Creates an org if the user doesn't have one, then generates keys up to the seat count.
 */
async function provisionTeamKeys(userId: string, plan: string, seats: number): Promise<void> {
  const { randomBytes } = await import('crypto');

  const user = await getUser(userId);
  if (!user) return;

  let orgId = user.orgId;

  // Create org automatically if user doesn't have one
  if (!orgId) {
    const orgName = (user.name || user.login || 'Team') + "'s Team";
    const org = await createOrg(orgName, user, seats);
    orgId = org.id;
    log.info({ userId, orgId, plan, seats }, 'Auto-created org for team plan');
  }

  // Generate keys up to the seat count (delta from existing active keys)
  const existingCount = await dbGetActiveTeamApiKeyCount(orgId);
  const toGenerate = Math.max(0, seats - existingCount);

  if (toGenerate > 0 && sql) {
    // Atomic: generate all keys in a single transaction
    await sql.begin(async (tx: any) => {
      for (let i = 0; i < toGenerate; i++) {
        const id = randomBytes(12).toString('hex');
        const apiKey = generateApiKey();
        const keyHash = hashApiKey(apiKey);
        const label = `Seat ${existingCount + i + 1}`;
        await tx`
          INSERT INTO team_api_keys (id, org_id, api_key, api_key_hash, label)
          VALUES (${id}, ${orgId}, ${null}, ${keyHash}, ${label})
        `;
      }
    });
  } else {
    for (let i = 0; i < toGenerate; i++) {
      const id = randomBytes(12).toString('hex');
      const apiKey = generateApiKey();
      const label = `Seat ${existingCount + i + 1}`;
      await dbCreateTeamApiKey({ id, orgId, apiKey, label });
    }
  }

  log.info({ userId, orgId, plan, seats, generated: toGenerate, existing: existingCount }, 'Team API keys provisioned');
}

async function handleSubscriptionUpdate(subscriptionPayload: unknown): Promise<void> {
  const subscription = toStripeSubscription(subscriptionPayload);
  if (!subscription) return;

  const customerId = subscription.customer;
  const user = await dbGetUserByStripeCustomer(customerId);
  if (!user) return;

  const priceId = subscription.items?.data?.[0]?.price?.id || '';
  const plan = priceToPlan(priceId);
  const tier = planToTier(plan);

  // Update user tier
  await dbUpdateUserTier(user.id, tier);

  // Update subscription record
  await dbUpsertSubscription(buildSubscriptionRecord(subscription.id, user.id, customerId, plan, subscription));

  // Provision additional team keys on upgrade (e.g. team-5 → team-10)
  // or revoke excess keys on downgrade (e.g. team-10 → team-5)
  const seats = planToSeats(plan);
  if (seats > 0) {
    try {
      await provisionTeamKeys(user.id, plan, seats);
      // Revoke excess keys if downgrading to fewer seats
      if (user.org_id) {
        const revoked = await dbRevokeExcessTeamApiKeys(user.org_id, seats);
        if (revoked > 0) {
          log.info({ userId: user.id, orgId: user.org_id, plan, revoked }, 'Revoked excess team API keys after plan downgrade');
          // Notify org owner about revoked keys
          if (user.email) {
            sendSubscriptionConfirmed(user.email, user.name || user.login, plan).catch(() => {});
          }
        }
      }
    } catch (err) {
      log.error({ err: (err as Error).message, userId: user.id, plan, seats }, 'Failed to provision/adjust team API keys on subscription update');
    }
  } else if (user.org_id) {
    // Downgraded from team to non-team plan — revoke all keys
    const revoked = await dbRevokeAllOrgTeamApiKeys(user.org_id);
    if (revoked > 0) {
      log.info({ userId: user.id, orgId: user.org_id, revoked }, 'Revoked all team API keys after downgrade to non-team plan');
      // Notify user that team keys were revoked
      if (user.email) {
        sendSubscriptionConfirmed(user.email, user.name || user.login, plan).catch(() => {});
      }
    }
  }

  log.info({ userId: user.id, plan, status: subscription.status }, 'Subscription updated');
}

async function handleSubscriptionDeleted(subscriptionPayload: unknown): Promise<void> {
  const subscription = toStripeSubscription(subscriptionPayload);
  if (!subscription) return;

  const customerId = subscription.customer;
  const user = await dbGetUserByStripeCustomer(customerId);
  if (!user) return;

  // Downgrade to free
  await dbUpdateUserTier(user.id, 'free');

  // Revoke all team API keys when subscription is canceled
  if (user.org_id) {
    const revoked = await dbRevokeAllOrgTeamApiKeys(user.org_id);
    if (revoked > 0) {
      log.info({ userId: user.id, orgId: user.org_id, revoked }, 'Revoked all team API keys after subscription cancellation');
    }
  }

  // Update subscription record
  await dbUpsertSubscription(buildSubscriptionRecord(subscription.id, user.id, customerId, 'free', null, { status: 'canceled' }));

  log.info({ userId: user.id, customerId }, 'Subscription canceled');
}

async function handlePaymentFailed(invoicePayload: unknown): Promise<void> {
  const invoice = toStripeInvoice(invoicePayload);
  if (!invoice) return;

  const customerId = invoice.customer;
  const user = await dbGetUserByStripeCustomer(customerId);
  if (!user) return;

  // Mark subscription as past_due but don't downgrade yet (Stripe will retry)
  const subscriptionId = invoice.subscription;
  if (subscriptionId) {
    const sub = await stripeRequest<StripeSubscription>(`/subscriptions/${subscriptionId}`, 'GET');
    const priceId = sub.items?.data?.[0]?.price?.id || '';
    const plan = priceToPlan(priceId);

    await dbUpsertSubscription(buildSubscriptionRecord(subscriptionId, user.id, customerId, plan, null, { status: 'past_due' }));
  }

  log.info({ userId: user.id, customerId, invoiceId: invoice.id }, 'Payment failed');

  // Notify the user so they can update their payment method
  if (user.email) {
    sendPaymentFailed(user.email, user.name || user.login).catch((err) => {
      log.warn({ err: (err as Error).message }, 'Failed to send payment failed email');
    });
  }
}

/**
 * Check if Stripe billing is configured.
 */
export function isStripeConfigured(): boolean {
  return !!STRIPE_SECRET_KEY;
}
