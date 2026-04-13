/**
 * Cullit Stripe Billing
 *
 * Handles:
 *   - Checkout session creation (single Pro plan with per-seat pricing)
 *   - Webhook processing (subscription lifecycle)
 *   - Customer portal sessions
 *   - Tier sync (Stripe status → user tier in DB)
 *   - Team API key provisioning and lifecycle (create on checkout, revoke on cancel/downgrade)
 *
 * Simplified pricing model:
 *   Free       → $0 (3 gens/month)
 *   Pro        → $9/seat/mo, 1+ seats (all features, per-seat limits)
 *   Enterprise → custom
 *
 * Environment Variables:
 *   STRIPE_SECRET_KEY              — Stripe API secret key (sk_test_... or sk_live_...)
 *   STRIPE_WEBHOOK_SECRET          — Webhook endpoint signing secret (whsec_...)
 *   STRIPE_PRO_PRICE_ID            — Price ID for Pro plan ($9/seat/mo)
 *   STRIPE_PRO_ANNUAL_PRICE_ID     — Price ID for Pro annual plan ($97.20/seat/yr)
 *   (Legacy fallbacks: STRIPE_PAID_PRICE_ID, STRIPE_TEAM_PRICE_ID, etc.)
 *   CULLIT_BASE_URL                — Public base URL for success/cancel redirects
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
import { getEffectiveTier, getUser, generateApiKey, createOrg, updateOrgMaxSeats } from './auth.js';
import { isRecord } from './utils.js';
import { log } from './logger.js';
import { sendPaymentFailed, sendSubscriptionConfirmed } from './email.js';
import { PAID_MIN_SEATS } from '@cullit/core';

const STRIPE_SECRET_KEY = process.env['STRIPE_SECRET_KEY'] || '';
const STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] || '';
// Price IDs — new names with legacy fallbacks
const STRIPE_PRO_PRICE_ID = process.env['STRIPE_PRO_PRICE_ID'] || process.env['STRIPE_PAID_PRICE_ID'] || process.env['STRIPE_TEAM_PRICE_ID'] || '';
const STRIPE_PRO_ANNUAL_PRICE_ID = process.env['STRIPE_PRO_ANNUAL_PRICE_ID'] || process.env['STRIPE_PAID_ANNUAL_PRICE_ID'] || process.env['STRIPE_TEAM_ANNUAL_PRICE_ID'] || '';

if (STRIPE_SECRET_KEY) {
  if (!STRIPE_PRO_PRICE_ID) log.warn('STRIPE_PRO_PRICE_ID not set — Pro checkout will fail');
}
const BASE_URL = process.env['CULLIT_BASE_URL'] || 'http://localhost:3000';
const DASHBOARD_URL = process.env['CULLIT_DASHBOARD_URL'] || BASE_URL;

// --- Webhook idempotency ---
// DB-backed via webhook_events table (survives restarts).
// In-memory Set kept as a fast-path cache to avoid DB round-trip on hot duplicates.

const MAX_PROCESSED_EVENTS = 1000;
const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const processedWebhookEvents = new Map<string, number>(); // eventId → timestamp

function markInMemory(eventId: string): void {
  processedWebhookEvents.set(eventId, Date.now());
  if (processedWebhookEvents.size > MAX_PROCESSED_EVENTS) {
    const first = processedWebhookEvents.keys().next().value;
    if (first) processedWebhookEvents.delete(first);
  }
}

async function isWebhookProcessed(eventId: string): Promise<boolean> {
  const ts = processedWebhookEvents.get(eventId);
  if (ts !== undefined) {
    if (Date.now() - ts > WEBHOOK_CACHE_TTL) {
      processedWebhookEvents.delete(eventId); // expired — fall through to DB
    } else {
      return true;
    }
  }
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
  metadata?: { user_id?: string; plan?: string; seats?: string };
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
  items?: { data?: Array<{ id?: string; quantity?: number; price?: { id?: string } }> };
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
          seats: typeof value.metadata.seats === 'string' ? value.metadata.seats : undefined,
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
    ? { data: value.items.data.filter(isRecord).map(item => ({ id: typeof item.id === 'string' ? item.id : undefined, quantity: typeof item.quantity === 'number' ? item.quantity : undefined, price: isRecord(item.price) ? { id: typeof item.price.id === 'string' ? item.price.id : undefined } : undefined })) }
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

async function stripeRequest<T>(path: string, method: string, body?: Record<string, string>, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
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
  if (priceId === STRIPE_PRO_PRICE_ID || priceId === STRIPE_PRO_ANNUAL_PRICE_ID) return 'pro';
  return 'free';
}

export function planToTier(plan: string): string {
  if (plan === 'paid' || plan === 'pro' || plan === 'team') return 'pro';
  return 'free';
}

export function planToSeats(plan: string, subscriptionQuantity?: number): number {
  if (plan === 'paid' || plan === 'pro' || plan === 'team') return subscriptionQuantity || PAID_MIN_SEATS;
  return 0;
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
  plan: 'pro' | 'paid' | 'team',
  annual: boolean,
  jsonFn: (res: ServerResponse, status: number, body: unknown) => void,
  res: ServerResponse,
  seats?: number,
): Promise<void> {
  log.info({ userId, plan, annual, seats }, 'Checkout request received');

  if (!STRIPE_SECRET_KEY) {
    jsonFn(res, 503, { error: 'Billing is not configured' });
    return;
  }

  const user = await dbGetUser(userId);
  if (!user) {
    jsonFn(res, 404, { error: 'User not found' });
    return;
  }

  // Seat count: 1+ seats, max 100
  const seatCount = Math.max(PAID_MIN_SEATS, Math.min(seats || PAID_MIN_SEATS, 100));

  // Resolve price ID — single pro plan
  const priceId = (annual && STRIPE_PRO_ANNUAL_PRICE_ID) ? STRIPE_PRO_ANNUAL_PRICE_ID : STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    jsonFn(res, 503, { error: 'Price not configured for pro plan' });
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
        // Update the subscription in-place: swap price, update quantity, prorate immediately
        const idempotencyKey = `sub_update_${userId}_${plan}_${seatCount}_${existingSub.stripe_subscription_id}`;
        await stripeRequest(`/subscriptions/${existingSub.stripe_subscription_id}`, 'POST', {
          'items[0][id]': itemId,
          'items[0][price]': priceId,
          'items[0][quantity]': String(seatCount),
          'proration_behavior': 'create_prorations',
          'metadata[plan]': plan,
          'metadata[seats]': String(seatCount),
        }, { 'Idempotency-Key': idempotencyKey });

        // Update tier immediately — webhook will also fire as confirmation
        const tier = planToTier(plan);
        await dbUpdateUserTier(userId, tier);

        log.info({ userId, plan, seats: seatCount, subscriptionId: existingSub.stripe_subscription_id }, 'Subscription updated (plan change)');
        jsonFn(res, 200, { updated: true, plan, seats: seatCount });
        return;
      }
    } catch (err) {
      log.warn({ err, userId, plan, subscriptionId: existingSub.stripe_subscription_id }, 'Failed to update existing subscription — falling back to new checkout session');
      // Fall through to create a new checkout session below
    }
  }

  // Idempotency key prevents duplicate checkout sessions on network retry
  const idempotencyKey = `checkout_${userId}_${plan}_${seatCount}`;
  const params: Record<string, string> = {
    'mode': 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': String(seatCount),
    'success_url': `${DASHBOARD_URL}/dashboard.html?billing=success`,
    'cancel_url': `${DASHBOARD_URL}/dashboard.html?billing=cancelled`,
    'client_reference_id': userId,
    'metadata[user_id]': userId,
    'metadata[plan]': plan,
    'metadata[seats]': String(seatCount),
  };

  // If user already has a Stripe customer ID, reuse it
  if (user.stripe_customer_id) {
    params['customer'] = user.stripe_customer_id;
  } else if (user.email) {
    params['customer_email'] = user.email;
  }

  try {
    const session = await stripeRequest<{ url?: string }>('/checkout/sessions', 'POST', params, { 'Idempotency-Key': idempotencyKey });
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

async function recordBillingAudit(
  action: string,
  target?: string | null,
  metadata?: Record<string, unknown> | null,
  userId?: string | null,
): Promise<void> {
  await dbRecordAuditEvent({
    userId: userId || null,
    action,
    target: target || null,
    metadata: metadata || null,
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
    await recordBillingAudit('billing.webhook_invalid_signature', null, { hasSignature: !!sigHeader });
    jsonFn(res, 400, { error: 'Invalid webhook signature' });
    return;
  }

  let event: StripeEvent;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    const normalized = toStripeEvent(parsed);
    if (!normalized) {
      await recordBillingAudit('billing.webhook_invalid_payload');
      jsonFn(res, 400, { error: 'Invalid Stripe event payload' });
      return;
    }
    event = normalized;
  } catch {
    await recordBillingAudit('billing.webhook_invalid_json');
    jsonFn(res, 400, { error: 'Invalid JSON' });
    return;
  }

  // Idempotency: skip already-processed events (DB-backed + in-memory cache)
  if (await isWebhookProcessed(event.id)) {
    await recordBillingAudit('billing.webhook_duplicate', event.id, { type: event.type });
    jsonFn(res, 200, { received: true, duplicate: true });
    return;
  }

  try {
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

    // Mark processed AFTER successful handling so Stripe can retry on failure
    await markWebhookProcessed(event.id, event.type);

    jsonFn(res, 200, { received: true });
  } catch (err) {
    await recordBillingAudit('billing.webhook_processing_failed', event.id, {
      type: event.type,
      error: (err as Error).message,
    });
    log.error({ err: (err as Error).message }, 'Stripe webhook error');
    jsonFn(res, 500, { error: 'Webhook processing failed' });
  }
}

async function retryProvisionKeys(userId: string, plan: string, seats: number, subscriptionId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await provisionTeamKeys(userId, plan, seats);
      return true;
    } catch (err) {
      log.warn({ err: (err as Error).message, userId, plan, seats, attempt }, `Team key provisioning attempt ${attempt} failed`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  log.error({ userId, plan, seats, subscriptionId }, 'Failed to provision team API keys after 3 attempts — issuing refund');
  await dbRecordAuditEvent({
    userId, action: 'team_key_provisioning_failed',
    target: subscriptionId,
    metadata: { plan, seats, attempts: 3 },
  });

  try {
    await stripeRequest(`/subscriptions/${subscriptionId}`, 'DELETE', {});
    log.info({ userId, subscriptionId }, 'Auto-canceled subscription after key provisioning failure');
    await dbRecordAuditEvent({
      userId, action: 'team_key_provisioning_auto_cancel',
      target: subscriptionId,
      metadata: { plan, seats, reason: 'provisioning_failure' },
    });
  } catch (cancelErr) {
    log.error({ err: (cancelErr as Error).message, userId, subscriptionId }, 'Failed to auto-cancel subscription — MANUAL INTERVENTION REQUIRED');
  }

  return false;
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

  const seats = plan === 'team'
    ? Math.max(PAID_MIN_SEATS, parseInt(session.metadata?.seats || String(PAID_MIN_SEATS), 10))
    : 0;

  await dbUpsertSubscription(buildSubscriptionRecord(subscriptionId, userId, customerId, plan, sub));
  await recordBillingAudit('billing.checkout_completed', subscriptionId, { customerId, plan, seats }, userId);

  log.info({ userId, plan, customerId }, 'Checkout complete');

  // Provision team API keys if this is a team plan
  if (seats > 0) {
    await retryProvisionKeys(userId, plan, seats, subscriptionId);
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
  } else {
    // Keep org.max_seats in sync with the Stripe subscription quantity
    await updateOrgMaxSeats(orgId, seats);
  }

  // Generate keys up to the seat count (delta from existing active keys)
  // Count and insert inside the same transaction to prevent TOCTOU race
  if (sql) {
    await sql.begin(async (tx: any) => {
      const countRows = await tx`SELECT COUNT(*)::text AS count FROM team_api_keys WHERE org_id = ${orgId} AND revoked_at IS NULL`;
      const existingCount = parseInt(countRows[0].count, 10);
      const toGenerate = Math.max(0, seats - existingCount);

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

      log.info({ userId, orgId, plan, seats, generated: toGenerate, existing: existingCount }, 'Team API keys provisioned');
    });
  } else {
    const existingCount = await dbGetActiveTeamApiKeyCount(orgId);
    const toGenerate = Math.max(0, seats - existingCount);
    for (let i = 0; i < toGenerate; i++) {
      const id = randomBytes(12).toString('hex');
      const apiKey = generateApiKey();
      const label = `Seat ${existingCount + i + 1}`;
      await dbCreateTeamApiKey({ id, orgId, apiKey, label });
    }
    log.info({ userId, orgId, plan, seats, generated: toGenerate, existing: existingCount }, 'Team API keys provisioned');
  }
}

async function handleSubscriptionUpdate(subscriptionPayload: unknown): Promise<void> {
  const subscription = toStripeSubscription(subscriptionPayload);
  if (!subscription) return;

  const customerId = subscription.customer;
  const user = await dbGetUserByStripeCustomer(customerId);
  if (!user) return;

  const priceId = subscription.items?.data?.[0]?.price?.id || '';
  const quantity = subscription.items?.data?.[0]?.quantity || PAID_MIN_SEATS;
  const plan = priceToPlan(priceId);
  const tier = planToTier(plan);

  // Update user tier
  await dbUpdateUserTier(user.id, tier);

  // Update subscription record
  await dbUpsertSubscription(buildSubscriptionRecord(subscription.id, user.id, customerId, plan, subscription));

  // Provision additional team keys on upgrade or revoke excess on downgrade
  const seats = planToSeats(plan, quantity);
  if (seats > 0) {
    try {
      await provisionTeamKeys(user.id, plan, seats);
      // Revoke excess keys if downgrading to fewer seats
      if (user.org_id) {
        const revoked = await dbRevokeExcessTeamApiKeys(user.org_id, seats);
        if (revoked > 0) {
          log.info({ userId: user.id, orgId: user.org_id, plan, revoked }, 'Revoked excess team API keys after seat reduction');
        }
      }
    } catch (err) {
      await recordBillingAudit('billing.team_sync_failed', subscription.id, {
        plan,
        seats,
        error: (err as Error).message,
      }, user.id);
      log.error({ err: (err as Error).message, userId: user.id, plan, seats }, 'Failed to provision/adjust team API keys on subscription update');
    }
  } else if (user.org_id) {
    // Downgraded from team to non-team plan.
    // If cancel_at_period_end is set, the subscription is still active until period end —
    // defer revocation to the customer.subscription.deleted event so CI/CD keys keep working.
    if (subscription.cancel_at_period_end) {
      log.info({ userId: user.id, orgId: user.org_id }, 'Team downgrade with cancel_at_period_end — deferring key revocation to subscription.deleted');
    } else {
      // Immediate plan change: revoke keys but log prominently so ops can intervene
      log.warn({ userId: user.id, orgId: user.org_id }, 'Immediate team→non-team downgrade — revoking all team API keys. CI/CD integrations using these keys will stop working.');
      const revoked = await dbRevokeAllOrgTeamApiKeys(user.org_id);
      if (revoked > 0) {
        log.info({ userId: user.id, orgId: user.org_id, revoked }, 'Revoked all team API keys after immediate downgrade to non-team plan');
        await dbRecordAuditEvent({
          userId: user.id, action: 'team_keys_revoked_immediate_downgrade',
          target: user.org_id,
          metadata: { revoked, previousPlan: 'team' },
        });
      }
    }
  }

  await recordBillingAudit('billing.subscription_updated', subscription.id, {
    plan,
    seats,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  }, user.id);
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

  await recordBillingAudit('billing.subscription_deleted', subscription.id, {
    customerId,
    status: subscription.status,
  }, user.id);
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

  await recordBillingAudit('billing.payment_failed', invoice.id, {
    customerId,
    subscriptionId: invoice.subscription,
  }, user.id);
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
