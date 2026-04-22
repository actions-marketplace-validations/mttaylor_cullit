/**
 * Billing route wrappers — resolve user, then delegate to billing handlers.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import { resolveUser } from '../auth.js';
import {
  handleCheckout, handleBillingPortal, handleGetSubscription, handleStripeWebhook,
} from '../billing.js';
import { log } from '../logger.js';
import { json, readBody, readJsonBody } from '../utils.js';

export async function handleCheckoutRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  log.info({ method: req.method, url: req.url, origin: req.headers['origin'] }, 'Checkout route entered');
  const user = await resolveUser(req);
  if (!user) { log.warn('Checkout: user not authenticated'); json(res, 401, { error: 'Not authenticated' }); return; }

  const body = await readJsonBody(req, res) as { plan?: string; annual?: boolean; seats?: number } | null;
  if (!body) { log.warn({ userId: user.id }, 'Checkout: invalid JSON body'); return; }

  const validPlans = ['pro', 'team'] as const;
  const plan = validPlans.includes(body.plan as typeof validPlans[number])
    ? (body.plan as typeof validPlans[number])
    : 'pro' as const;
  const annual = body.annual === true;
  const seats = typeof body.seats === 'number' ? body.seats : undefined;
  await handleCheckout(user.id, plan, annual, json, res, seats);
}

export async function handleBillingPortalRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  await handleBillingPortal(user.id, json, res);
}

export async function handleGetSubscriptionRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  await handleGetSubscription(user.id, json, res);
}

export async function handleStripeWebhookRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  await handleStripeWebhook(req, raw, json, res);
}
