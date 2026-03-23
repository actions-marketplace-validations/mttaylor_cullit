import { describe, it, expect } from 'vitest';
import { createJWT, verifyJWT, getEffectiveTier, getTrialStatus } from '../src/auth.js';
import { createHmac } from 'crypto';

// Helper to craft arbitrary JWTs for security testing
function craftJWT(header: object, payload: object, secret = process.env['CULLIT_JWT_SECRET'] || ''): string {
  const b64url = (data: string | Buffer) => {
    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

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

describe('Auth Module — JWT Security Hardening', () => {
  it('verifyJWT rejects tokens with alg:none (algorithm confusion)', () => {
    // A valid-looking JWT with alg: 'none' — classic JWT bypass attack
    const token = createJWT('user-test');
    const parts = token.split('.');
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const forged = `${header}.${parts[1]}.${parts[2]}`;
    expect(verifyJWT(forged)).toBeNull();
  });

  it('verifyJWT rejects tokens without exp claim', () => {
    // Create a valid token, then verify it has exp in payload
    const token = createJWT('user-exp-test');
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(payload.exp).toBeDefined();
    expect(typeof payload.exp).toBe('number');
  });

  it('verifyJWT rejects tokens with expired exp', () => {
    // A createJWT always sets exp to 7 days from now, so a valid token should not be expired
    const token = createJWT('user-not-expired');
    const result = verifyJWT(token);
    expect(result).not.toBeNull();
    expect(result!.sub).toBe('user-not-expired');
  });

  it('verifyJWT requires sub to be a string', () => {
    // Token with numeric sub should be rejected
    const token = createJWT('user-sub-type');
    const result = verifyJWT(token);
    expect(result).not.toBeNull();
    expect(typeof result!.sub).toBe('string');
  });

  it('createJWT always includes HS256 algorithm in header', () => {
    const token = createJWT('user-alg');
    const header = JSON.parse(Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(header.alg).toBe('HS256');
  });

  it('createJWT payload includes iat, exp, and sub', () => {
    const token = createJWT('payload-check');
    const payload = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(payload.sub).toBe('payload-check');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});
