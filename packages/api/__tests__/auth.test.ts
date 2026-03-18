import { describe, it, expect } from 'vitest';
import { createJWT, verifyJWT, getEffectiveTier, getTrialStatus } from '../src/auth.js';

describe('Auth Module — JWT', () => {
  it('createJWT returns a valid JWT string', () => {
    const token = createJWT('user-123');
    expect(token).toBeTruthy();
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyJWT returns the subject for a valid token', () => {
    const token = createJWT('user-456');
    const result = verifyJWT(token);
    expect(result).not.toBeNull();
    expect(result!.sub).toBe('user-456');
  });

  it('verifyJWT rejects a tampered token', () => {
    const token = createJWT('user-789');
    const parts = token.split('.');
    // Tamper with payload
    parts[1] = parts[1] + 'x';
    const tampered = parts.join('.');
    expect(verifyJWT(tampered)).toBeNull();
  });

  it('verifyJWT rejects a malformed token', () => {
    expect(verifyJWT('')).toBeNull();
    expect(verifyJWT('a.b')).toBeNull();
    expect(verifyJWT('not-a-jwt')).toBeNull();
  });

  it('verifyJWT rejects a token with wrong signature', () => {
    const token = createJWT('user-abc');
    const parts = token.split('.');
    // Replace signature with garbage of same length
    parts[2] = 'x'.repeat(parts[2].length);
    expect(verifyJWT(parts.join('.'))).toBeNull();
  });

  it('createJWT produces unique tokens for different users', () => {
    const t1 = createJWT('user-1');
    const t2 = createJWT('user-2');
    expect(t1).not.toBe(t2);
  });

  it('getTrialStatus returns active trial details for a free user in trial', () => {
    const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const status = getTrialStatus({
      id: '1', login: 'octo', name: 'Octo', email: '', avatarUrl: '',
      tier: 'free', orgId: null, role: 'member', apiKey: 'clt_test',
      trialTier: 'pro', trialStartsAt: new Date().toISOString(), trialEndsAt: endsAt,
      createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString(),
    });
    expect(status.active).toBe(true);
    expect(status.tier).toBe('pro');
    expect(status.daysRemaining).toBeGreaterThan(0);
  });

  it('getEffectiveTier returns active trial tier before paid tier exists', () => {
    const effective = getEffectiveTier({
      id: '1', login: 'octo', name: 'Octo', email: '', avatarUrl: '',
      tier: 'free', orgId: null, role: 'member', apiKey: 'clt_test',
      trialTier: 'pro', trialStartsAt: new Date().toISOString(),
      trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString(),
    });
    expect(effective).toBe('pro');
  });
});
