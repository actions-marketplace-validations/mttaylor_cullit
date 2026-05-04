/**
 * Legacy billing route wrappers.
 * Cullit now runs as a fully open-source project funded via GitHub Sponsors,
 * so billing routes are intentionally disabled but preserved for compatibility.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import { resolveUser } from '../auth.js';
import { log } from '../logger.js';
import { json } from '../utils.js';

function billingDisabled(res: ServerResponse): void {
  json(res, 410, {
    error: 'Billing has been retired. Cullit is fully open source.',
    sponsorUrl: 'https://github.com/sponsors/mttaylor',
  });
}

export async function handleCheckoutRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  log.info({ method: req.method, url: req.url, origin: req.headers['origin'] }, 'Checkout route entered');
  const user = await resolveUser(req);
  if (!user) { log.warn('Checkout: user not authenticated'); json(res, 401, { error: 'Not authenticated' }); return; }
  billingDisabled(res);
}

export async function handleBillingPortalRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  billingDisabled(res);
}

export async function handleGetSubscriptionRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }
  json(res, 200, {
    active: false,
    status: 'retired',
    plan: 'open-source',
    sponsorUrl: 'https://github.com/sponsors/mttaylor',
  });
}

export async function handleStripeWebhookRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  void req;
  json(res, 410, { error: 'Stripe webhooks are disabled in open-source mode' });
}
