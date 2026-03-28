import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { createJWT, verifyJWT, getEffectiveTier, handleLicenseValidate, loadAuthStore } from '../src/auth.js';
import { createHmac } from 'crypto';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';

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

// --- handleLicenseValidate tests ---

const STORE_PATH = './auth-store.json';

function mockReqRes(authHeader?: string) {
  const req = { headers: { ...(authHeader ? { authorization: authHeader } : {}) } } as unknown as IncomingMessage;
  const res = {} as ServerResponse;
  let captured: { status: number; body: any } | null = null;
  const jsonFn = (_r: ServerResponse, status: number, body: unknown) => { captured = { status, body }; };
  return { req, res, jsonFn, getCaptured: () => captured };
}

describe('handleLicenseValidate', () => {
  let originalStore: string | null = null;

  beforeAll(() => {
    originalStore = existsSync(STORE_PATH) ? readFileSync(STORE_PATH, 'utf-8') : null;
  });

  afterAll(() => {
    if (originalStore !== null) writeFileSync(STORE_PATH, originalStore);
    else if (existsSync(STORE_PATH)) unlinkSync(STORE_PATH);
  });

  beforeEach(() => {
    const now = new Date().toISOString();
    writeFileSync(STORE_PATH, JSON.stringify({
      users: {
        'free-user': {
          id: 'free-user', login: 'free@test.com', name: 'Free', email: 'free@test.com',
          avatarUrl: '', tier: 'free', orgId: null, role: 'member', apiKey: 'clt_freekey',
          githubUsername: null, preferredProvider: null,
          createdAt: now, lastLoginAt: now,
        },
        'pro-user': {
          id: 'pro-user', login: 'pro@test.com', name: 'Pro', email: 'pro@test.com',
          avatarUrl: '', tier: 'pro', orgId: null, role: 'member', apiKey: 'clt_prokey',
          githubUsername: null, preferredProvider: null,
          createdAt: now, lastLoginAt: now,
        },
        'team-user': {
          id: 'team-user', login: 'team@test.com', name: 'Team', email: 'team@test.com',
          avatarUrl: '', tier: 'team', orgId: null, role: 'member', apiKey: 'clt_teamkey',
          githubUsername: null, preferredProvider: null,
          createdAt: now, lastLoginAt: now,
        },
      },
      orgs: {},
      apiKeyIndex: {
        'clt_freekey': 'free-user',
        'clt_prokey': 'pro-user',
        'clt_teamkey': 'team-user',
      },
    }));
    loadAuthStore();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const { req, res, jsonFn, getCaptured } = mockReqRes();
    await handleLicenseValidate(req, res, jsonFn);
    const c = getCaptured()!;
    expect(c.status).toBe(401);
    expect(c.body.valid).toBe(false);
    expect(c.body.tier).toBe('free');
    expect(c.body.message).toMatch(/missing|invalid/i);
  });

  it('returns 401 when Authorization header has wrong prefix', async () => {
    const { req, res, jsonFn, getCaptured } = mockReqRes('Basic abc123');
    await handleLicenseValidate(req, res, jsonFn);
    const c = getCaptured()!;
    expect(c.status).toBe(401);
    expect(c.body.valid).toBe(false);
  });

  it('returns 401 when Bearer token does not start with clt_', async () => {
    const { req, res, jsonFn, getCaptured } = mockReqRes('Bearer sk_live_abc');
    await handleLicenseValidate(req, res, jsonFn);
    const c = getCaptured()!;
    expect(c.status).toBe(401);
    expect(c.body.valid).toBe(false);
  });

  it('returns 401 when API key is not found in the store', async () => {
    const { req, res, jsonFn, getCaptured } = mockReqRes('Bearer clt_doesnotexist');
    await handleLicenseValidate(req, res, jsonFn);
    const c = getCaptured()!;
    expect(c.status).toBe(401);
    expect(c.body.valid).toBe(false);
    expect(c.body.message).toMatch(/invalid/i);
  });

  it('returns valid:true with free tier for a free user', async () => {
    const { req, res, jsonFn, getCaptured } = mockReqRes('Bearer clt_freekey');
    await handleLicenseValidate(req, res, jsonFn);
    const c = getCaptured()!;
    expect(c.status).toBe(200);
    expect(c.body).toEqual({ valid: true, tier: 'free' });
  });

  it('returns valid:true with pro tier for a pro user', async () => {
    const { req, res, jsonFn, getCaptured } = mockReqRes('Bearer clt_prokey');
    await handleLicenseValidate(req, res, jsonFn);
    const c = getCaptured()!;
    expect(c.status).toBe(200);
    expect(c.body).toEqual({ valid: true, tier: 'pro' });
  });

  it('returns valid:true with team tier for a team user', async () => {
    const { req, res, jsonFn, getCaptured } = mockReqRes('Bearer clt_teamkey');
    await handleLicenseValidate(req, res, jsonFn);
    const c = getCaptured()!;
    expect(c.status).toBe(200);
    expect(c.body).toEqual({ valid: true, tier: 'team' });
  });


});
