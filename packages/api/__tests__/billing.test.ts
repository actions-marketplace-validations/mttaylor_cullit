import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { isStripeConfigured, priceToPlan, planToTier, planToSeats } from '../src/billing.js';

describe('Billing Module', () => {
  it('isStripeConfigured returns false when STRIPE_SECRET_KEY is not set', () => {
    expect(isStripeConfigured()).toBe(false);
  });

  it('exports handleCheckout, handleBillingPortal, handleGetSubscription, handleStripeWebhook', async () => {
    const billing = await import('../src/billing.js');
    expect(typeof billing.handleCheckout).toBe('function');
    expect(typeof billing.handleBillingPortal).toBe('function');
    expect(typeof billing.handleGetSubscription).toBe('function');
    expect(typeof billing.handleStripeWebhook).toBe('function');
  });

  describe('handleCheckout — no Stripe key', () => {
    it('returns 503 when Stripe is not configured', async () => {
      const { handleCheckout } = await import('../src/billing.js');
      let captured: { status: number; body: unknown } | null = null;
      const mockJson = (_res: any, status: number, body: unknown) => {
        captured = { status, body };
      };
      const mockRes = {} as any;
      await handleCheckout('user-123', 'pro', false, mockJson, mockRes);
      expect(captured).not.toBeNull();
      expect(captured!.status).toBe(503);
    });
  });

  describe('handleBillingPortal — no Stripe key', () => {
    it('returns 503 when Stripe is not configured', async () => {
      const { handleBillingPortal } = await import('../src/billing.js');
      let captured: { status: number; body: unknown } | null = null;
      const mockJson = (_res: any, status: number, body: unknown) => {
        captured = { status, body };
      };
      const mockRes = {} as any;
      await handleBillingPortal('user-123', mockJson, mockRes);
      expect(captured).not.toBeNull();
      expect(captured!.status).toBe(503);
    });
  });

  describe('handleGetSubscription — no DB', () => {
    it('returns 404 for non-existent user', async () => {
      const { handleGetSubscription } = await import('../src/billing.js');
      let captured: { status: number; body: any } | null = null;
      const mockJson = (_res: any, status: number, body: unknown) => {
        captured = { status, body };
      };
      const mockRes = {} as any;
      await handleGetSubscription('user-123', mockJson, mockRes);
      expect(captured).not.toBeNull();
      expect(captured!.status).toBe(404);
      expect(captured!.body.error).toContain('User not found');
    });
  });

  describe('handleStripeWebhook — invalid signature', () => {
    it('returns 400 for invalid webhook signature', async () => {
      const { handleStripeWebhook } = await import('../src/billing.js');
      let captured: { status: number; body: any } | null = null;
      const mockJson = (_res: any, status: number, body: unknown) => {
        captured = { status, body };
      };
      const mockReq = { headers: { 'stripe-signature': 'fake-sig' } } as any;
      const mockRes = {} as any;
      await handleStripeWebhook(mockReq, '{}', mockJson, mockRes);
      expect(captured).not.toBeNull();
      expect(captured!.status).toBe(400);
      expect(captured!.body.error).toContain('signature');
    });
  });
});

describe('Billing — plan mapping functions', () => {
  describe('priceToPlan', () => {
    it('returns "free" for unknown price ID', () => {
      expect(priceToPlan('price_unknown')).toBe('free');
    });
  });

  describe('planToTier', () => {
    it('maps "pro" to "pro"', () => {
      expect(planToTier('pro')).toBe('pro');
    });

    it('maps "team" to "team"', () => {
      expect(planToTier('team')).toBe('team');
    });

    it('maps "basic" to "free" (legacy)', () => {
      expect(planToTier('basic')).toBe('free');
    });

    it('returns "free" for unknown plan', () => {
      expect(planToTier('unknown')).toBe('free');
    });
  });

  describe('planToSeats', () => {
    it('returns default 5 for "team" plan without quantity', () => {
      expect(planToSeats('team')).toBe(5);
    });

    it('returns subscription quantity for "team" plan', () => {
      expect(planToSeats('team', 10)).toBe(10);
    });

    it('returns subscription quantity for "team" plan with 25 seats', () => {
      expect(planToSeats('team', 25)).toBe(25);
    });

    it('returns 0 for non-team plans', () => {
      expect(planToSeats('pro')).toBe(0);
      expect(planToSeats('free')).toBe(0);
    });
  });
});

describe('Webhook HMAC verification', () => {
  const TEST_SECRET = 'whsec_test_secret_for_unit_tests';

  function buildSignature(payload: string, secret: string, timestamp?: number): string {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    return `t=${ts},v1=${sig}`;
  }

  beforeEach(() => {
    vi.resetModules();
    process.env['STRIPE_WEBHOOK_SECRET'] = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env['STRIPE_WEBHOOK_SECRET'];
  });

  it('accepts a correctly signed webhook payload', async () => {
    const { verifyWebhookSignature } = await import('../src/billing.js');

    const payload = '{"id":"evt_test","type":"checkout.session.completed"}';
    const sigHeader = buildSignature(payload, TEST_SECRET);

    expect(verifyWebhookSignature(payload, sigHeader)).toBe(true);
  });

  it('rejects a payload with wrong secret', async () => {
    const { verifyWebhookSignature } = await import('../src/billing.js');

    const payload = '{"id":"evt_test","type":"checkout.session.completed"}';
    const sigHeader = buildSignature(payload, 'wrong_secret');

    expect(verifyWebhookSignature(payload, sigHeader)).toBe(false);
  });

  it('rejects a payload with tampered body', async () => {
    const { verifyWebhookSignature } = await import('../src/billing.js');

    const payload = '{"id":"evt_test","type":"checkout.session.completed"}';
    const sigHeader = buildSignature(payload, TEST_SECRET);

    expect(verifyWebhookSignature('{"id":"evt_tampered"}', sigHeader)).toBe(false);
  });

  it('rejects a timestamp outside the 5-minute tolerance', async () => {
    const { verifyWebhookSignature } = await import('../src/billing.js');

    const payload = '{"id":"evt_test"}';
    const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const sigHeader = buildSignature(payload, TEST_SECRET, oldTs);

    expect(verifyWebhookSignature(payload, sigHeader)).toBe(false);
  });
});
