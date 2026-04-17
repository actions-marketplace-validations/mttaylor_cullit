import { describe, it, expect, beforeEach } from 'vitest';
import { isEmailConfigured, _isEmailThrottled, _recordEmailSent, _EMAIL_THROTTLE_MAX, _resetThrottleState } from '../src/email.js';

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

  it('sendSubscriptionConfirmed handles team plan', async () => {
    const { sendSubscriptionConfirmed } = await import('../src/email.js');
    const result = await sendSubscriptionConfirmed('test@example.com', 'Test User', 'team');
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

describe('Email Throttle', () => {
  beforeEach(() => { _resetThrottleState(); });

  it('allows emails under threshold', () => {
    const recipient = 'user@example.com';
    expect(_isEmailThrottled(recipient)).toBe(false);
  });

  it('throttles after max emails', () => {
    const recipient = 'flood@example.com';
    for (let i = 0; i < _EMAIL_THROTTLE_MAX; i++) {
      expect(_isEmailThrottled(recipient)).toBe(false);
      _recordEmailSent(recipient);
    }
    expect(_isEmailThrottled(recipient)).toBe(true);
  });

  it('tracks recipients independently', () => {
    for (let i = 0; i < _EMAIL_THROTTLE_MAX; i++) _recordEmailSent('a@test.com');
    expect(_isEmailThrottled('a@test.com')).toBe(true);
    expect(_isEmailThrottled('b@test.com')).toBe(false);
  });

  it('does not throttle unknown recipients', () => {
    expect(_isEmailThrottled('new@test.com')).toBe(false);
  });
});
