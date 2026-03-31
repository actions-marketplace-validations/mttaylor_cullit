import { describe, it, expect } from 'vitest';
import { isEmailConfigured } from '../src/email.js';

describe('Email Module', () => {
  it('isEmailConfigured returns false when RESEND_API_KEY is not set', () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it('exports all expected email functions', async () => {
    const email = await import('../src/email.js');
    expect(typeof email.sendWelcome).toBe('function');
    expect(typeof email.sendSubscriptionConfirmed).toBe('function');
    expect(typeof email.sendPaymentFailed).toBe('function');
    expect(typeof email.sendUsageAlert).toBe('function');
  });

  it('sendWelcome returns false when RESEND_API_KEY is not set', async () => {
    const { sendWelcome } = await import('../src/email.js');
    const result = await sendWelcome('test@example.com', 'Test User');
    expect(result).toBe(false);
  });

  it('sendSubscriptionConfirmed returns false when RESEND_API_KEY is not set', async () => {
    const { sendSubscriptionConfirmed } = await import('../src/email.js');
    const result = await sendSubscriptionConfirmed('test@example.com', 'Test User', 'pro');
    expect(result).toBe(false);
  });

  it('sendSubscriptionConfirmed handles basic plan', async () => {
    const { sendSubscriptionConfirmed } = await import('../src/email.js');
    const result = await sendSubscriptionConfirmed('test@example.com', 'Test User', 'basic');
    expect(result).toBe(false);
  });

  it('sendSubscriptionConfirmed handles team-5 plan', async () => {
    const { sendSubscriptionConfirmed } = await import('../src/email.js');
    const result = await sendSubscriptionConfirmed('test@example.com', 'Test User', 'team-5');
    expect(result).toBe(false);
  });

  it('sendSubscriptionConfirmed handles team-10 plan', async () => {
    const { sendSubscriptionConfirmed } = await import('../src/email.js');
    const result = await sendSubscriptionConfirmed('test@example.com', 'Test User', 'team-10');
    expect(result).toBe(false);
  });

  it('sendSubscriptionConfirmed handles team-25 plan', async () => {
    const { sendSubscriptionConfirmed } = await import('../src/email.js');
    const result = await sendSubscriptionConfirmed('test@example.com', 'Test User', 'team-25');
    expect(result).toBe(false);
  });

  it('sendPaymentFailed returns false when RESEND_API_KEY is not set', async () => {
    const { sendPaymentFailed } = await import('../src/email.js');
    const result = await sendPaymentFailed('test@example.com', 'Test User');
    expect(result).toBe(false);
  });

  it('sendUsageAlert returns false when RESEND_API_KEY is not set', async () => {
    const { sendUsageAlert } = await import('../src/email.js');
    const result = await sendUsageAlert('test@example.com', 'Test User', 400, 500);
    expect(result).toBe(false);
  });

});

