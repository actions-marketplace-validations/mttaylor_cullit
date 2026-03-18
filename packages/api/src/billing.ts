/**
 * Cullit Stripe Billing
 *
 * Handles:
 *   - Checkout session creation (Pro / Team plans)
 *   - Webhook processing (subscription lifecycle)
 *   - Customer portal sessions
 *   - Tier sync (Stripe status → user tier in DB)
 *
 * Environment Variables:
 *   STRIPE_SECRET_KEY      — Stripe API secret key (sk_test_... or sk_live_...)
 *   STRIPE_WEBHOOK_SECRET  — Webhook endpoint signing secret (whsec_...)
 *   STRIPE_PRO_PRICE_ID         — Price ID for Pro plan ($9/mo)
 *   STRIPE_TEAM_PRICE_ID        — Price ID for Team plan ($19/seat/mo)
 *   CULLIT_BASE_URL             — Public base URL for success/cancel redirects
 *
 * NOTE: We use Stripe's REST API directly instead of the SDK
 * to maintain our zero external runtime dependency principle
 * (postgres is the only runtime dep).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  sql, dbGetUser, dbUpdateUserTier, dbUpdateUserStripe, dbClearUserTrial,
  dbUpsertSubscription, dbGetSubscription, dbGetUserByStripeCustomer,
} from './db.js';
import { getEffectiveTier, getTrialStatus, getUser } from './auth.js';
import { log } from './logger.js';

const STRIPE_SECRET_KEY = process.env['STRIPE_SECRET_KEY'] || '';
const STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] || '';
const STRIPE_PRO_PRICE_ID = process.env['STRIPE_PRO_PRICE_ID'] || '';
const STRIPE_TEAM_PRICE_ID = process.env['STRIPE_TEAM_PRICE_ID'] || '';
const BASE_URL = process.env['CULLIT_BASE_URL'] || 'http://localhost:3000';

// --- Stripe API helpers ---

async function stripeRequest(path: string, method: string, body?: Record<string, string>): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe API error: ${data.error?.message || res.statusText}`);
  }
  return data;
}

// --- Webhook signature verification ---

function verifyWebhookSignature(payload: string, sigHeader: string): boolean {
  if (!STRIPE_WEBHOOK_SECRET) return false;

  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    if (key === 't') acc.timestamp = value;
    if (key === 'v1') acc.signatures.push(value);
    return acc;
  }, { timestamp: '', signatures: [] as string[] });

  if (!parts.timestamp || parts.signatures.length === 0) return false;

  // Reject timestamps older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - parseInt(parts.timestamp, 10));
  if (age > 300) return false;

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

// --- Plan mapping ---

function priceToPlan(priceId: string): string {
  if (priceId === STRIPE_PRO_PRICE_ID) return 'pro';
  if (priceId === STRIPE_TEAM_PRICE_ID) return 'team';
  return 'free';
}

function planToTier(plan: string): string {
  if (plan === 'pro') return 'pro';
  if (plan === 'team') return 'team';
  return 'free';
}

// --- Checkout ---

export async function handleCheckout(
  userId: string,
  plan: 'pro' | 'team',
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

  const priceId = plan === 'team' ? STRIPE_TEAM_PRICE_ID : STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    jsonFn(res, 503, { error: `Price not configured for ${plan} plan` });
    return;
  }

  const params: Record<string, string> = {
    'mode': 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': `${BASE_URL}/dashboard.html?billing=success`,
    'cancel_url': `${BASE_URL}/dashboard.html?billing=cancelled`,
    'client_reference_id': userId,
    'metadata[user_id]': userId,
    'metadata[plan]': plan,
  };

  // If user already has a Stripe customer ID, reuse it
  if (user.stripe_customer_id) {
    params['customer'] = user.stripe_customer_id;
  } else {
    params['customer_email'] = user.email || undefined!;
  }

  const session = await stripeRequest('/checkout/sessions', 'POST', params);
  jsonFn(res, 200, { url: session.url });
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

  const session = await stripeRequest('/billing_portal/sessions', 'POST', {
    'customer': user.stripe_customer_id,
    'return_url': `${BASE_URL}/dashboard.html`,
  });

  jsonFn(res, 200, { url: session.url });
}

// --- Get subscription status ---

export async function handleGetSubscription(
  userId: string,
  jsonFn: (res: ServerResponse, status: number, body: unknown) => void,
  res: ServerResponse,
): Promise<void> {
  const user = await getUser(userId);
  const effectiveTier = user ? getEffectiveTier(user) : 'free';
  const trial = user ? getTrialStatus(user) : { active: false, expired: false, tier: null, startsAt: null, endsAt: null, daysRemaining: 0 };
  const sub = await dbGetSubscription(userId);
  if (!sub) {
    jsonFn(res, 200, { subscription: null, plan: effectiveTier, tier: user?.tier || 'free', effectiveTier, trial });
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
    tier: user?.tier || sub.plan,
    effectiveTier,
    trial,
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

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    jsonFn(res, 400, { error: 'Invalid JSON' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
    }

    jsonFn(res, 200, { received: true });
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Stripe webhook error');
    jsonFn(res, 500, { error: 'Webhook processing failed' });
  }
}

async function handleCheckoutComplete(session: any): Promise<void> {
  const userId = session.client_reference_id || session.metadata?.user_id;
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const plan = session.metadata?.plan || 'pro';

  if (!userId || !customerId || !subscriptionId) return;

  // Link Stripe customer to user
  await dbUpdateUserStripe(userId, customerId, subscriptionId);

  // Update user tier
  const tier = planToTier(plan);
  await dbUpdateUserTier(userId, tier);
  await dbClearUserTrial(userId);

  // Fetch full subscription details from Stripe
  const sub = await stripeRequest(`/subscriptions/${subscriptionId}`, 'GET');

  await dbUpsertSubscription({
    id: subscriptionId,
    userId,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerId,
    plan,
    status: sub.status || 'active',
    currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : undefined,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
    cancelAtPeriodEnd: sub.cancel_at_period_end || false,
  });

  log.info({ userId, plan, customerId }, 'Checkout complete');
}

async function handleSubscriptionUpdate(subscription: any): Promise<void> {
  const customerId = subscription.customer;
  const user = await dbGetUserByStripeCustomer(customerId);
  if (!user) return;

  const priceId = subscription.items?.data?.[0]?.price?.id || '';
  const plan = priceToPlan(priceId);
  const tier = planToTier(plan);

  // Update user tier
  await dbUpdateUserTier(user.id, tier);
  if (tier !== 'free') {
    await dbClearUserTrial(user.id);
  }

  // Update subscription record
  await dbUpsertSubscription({
    id: subscription.id,
    userId: user.id,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    plan,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : undefined,
    currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : undefined,
    cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
  });

  log.info({ userId: user.id, plan, status: subscription.status }, 'Subscription updated');
}

async function handleSubscriptionDeleted(subscription: any): Promise<void> {
  const customerId = subscription.customer;
  const user = await dbGetUserByStripeCustomer(customerId);
  if (!user) return;

  // Downgrade to free
  await dbUpdateUserTier(user.id, 'free');

  // Update subscription record
  await dbUpsertSubscription({
    id: subscription.id,
    userId: user.id,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    plan: 'free',
    status: 'canceled',
  });

  log.info({ userId: user.id, customerId }, 'Subscription canceled');
}

async function handlePaymentFailed(invoice: any): Promise<void> {
  const customerId = invoice.customer;
  const user = await dbGetUserByStripeCustomer(customerId);
  if (!user) return;

  // Mark subscription as past_due but don't downgrade yet (Stripe will retry)
  const subscriptionId = invoice.subscription;
  if (subscriptionId) {
    const sub = await stripeRequest(`/subscriptions/${subscriptionId}`, 'GET');
    const priceId = sub.items?.data?.[0]?.price?.id || '';
    const plan = priceToPlan(priceId);

    await dbUpsertSubscription({
      id: subscriptionId,
      userId: user.id,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      plan,
      status: 'past_due',
    });
  }

  log.info({ userId: user.id, customerId, invoiceId: invoice.id }, 'Payment failed');
}

/**
 * Check if Stripe billing is configured.
 */
export function isStripeConfigured(): boolean {
  return !!STRIPE_SECRET_KEY;
}
