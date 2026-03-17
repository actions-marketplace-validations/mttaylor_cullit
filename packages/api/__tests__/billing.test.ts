import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isStripeConfigured } from '../src/billing.js';

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
      await handleCheckout('user-123', 'pro', mockJson, mockRes);
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
    it('returns null subscription when no DB is configured', async () => {
      const { handleGetSubscription } = await import('../src/billing.js');
      let captured: { status: number; body: any } | null = null;
      const mockJson = (_res: any, status: number, body: unknown) => {
        captured = { status, body };
      };
      const mockRes = {} as any;
      await handleGetSubscription('user-123', mockJson, mockRes);
      expect(captured).not.toBeNull();
      expect(captured!.status).toBe(200);
      expect(captured!.body.subscription).toBeNull();
      expect(captured!.body.plan).toBe('free');
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
