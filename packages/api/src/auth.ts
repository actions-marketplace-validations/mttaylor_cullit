/**
 * Cullit Auth Module
 *
 * WorkOS AuthKit login + JWT session tokens.
 * Stores users in file-backed JSON (same pattern as changelog store).
 *
 * Flow:
 *   1. GET /auth/login        → redirect to WorkOS AuthKit hosted login
 *   2. GET /auth/callback     → exchange code for token, create/update user, issue JWT
 *   3. GET /auth/me           → return current user from JWT
 *   4. POST /auth/logout      → invalidate session (client clears cookie)
 *
 * Environment Variables:
 *   WORKOS_CLIENT_ID        — WorkOS AuthKit client ID
 *   WORKOS_API_KEY          — WorkOS API key (secret)
 *   CULLIT_JWT_SECRET       — Secret for signing JWTs (min 32 chars)
 *   CULLIT_AUTH_STORE_PATH  — Path to auth store JSON (default: ./auth-store.json)
 *   CULLIT_BASE_URL         — Public base URL for callbacks (default: http://localhost:3000)
 *   CULLIT_DASHBOARD_URL    — Post-login redirect URL (default: CULLIT_BASE_URL)
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  dbGetUser, dbGetUserByApiKey, dbUpsertUser, dbRotateApiKey,
  dbUpdateUserOrg, dbGetOrg, dbGetOrgBySlug, dbCreateOrg, dbGetOrgMemberCount,
  dbAddOrgMember, dbAddOrgMemberAtomic, dbRemoveOrgMember, dbGetOrgMembers,
  dbRevokeToken, dbIsTokenRevoked, dbDeleteUser, dbGetTokensRevokedBefore,
  dbGetTeamApiKeyByKey, dbUpdatePreferredProvider, dbRevokeAllUserTokens,
  dbGetSubscription, dbUpdateOrgMaxSeats,
  hashApiKey,
  sql,
  type DbUser, type DbOrg,
} from './db.js';
import { sendWelcome } from './email.js';
import { log } from './logger.js';
import { readBody } from './utils.js';
import { getFeatureGating, AI_PROVIDERS } from '@cullit/core';

/** Whether PostgreSQL is available */
export const useDb = !!process.env['DATABASE_URL'];

// --- Config ---

const WORKOS_CLIENT_ID = process.env['WORKOS_CLIENT_ID'] || '';
const WORKOS_API_KEY = process.env['WORKOS_API_KEY'] || '';
const JWT_SECRET = (() => {
  const envSecret = process.env['CULLIT_JWT_SECRET'];
  if (envSecret) {
    if (envSecret.length < 32) {
      throw new Error('CULLIT_JWT_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    return envSecret;
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('CULLIT_JWT_SECRET is required in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  const fallback = randomBytes(32).toString('hex');
  log.warn('CULLIT_JWT_SECRET is not set — using random key. Sessions will not survive restarts.');
  return fallback;
})();
const AUTH_STORE_PATH = process.env['CULLIT_AUTH_STORE_PATH'] || './auth-store.json';
const BASE_URL = process.env['CULLIT_BASE_URL'] || 'http://localhost:3000';
const DASHBOARD_URL = process.env['CULLIT_DASHBOARD_URL'] || BASE_URL;
const JWT_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds
const SESSION_COOKIE_NAME = 'cullit_session';
const IS_HTTPS = BASE_URL.startsWith('https');
// Lax is correct: dashboard & API share the same registrable domain (same-site).
// SameSite=None would require Secure, which doesn't work on localhost HTTP.
const COOKIE_SAMESITE = 'Lax';
const COOKIE_SECURE_FLAG = IS_HTTPS ? '; Secure' : '';
const COOKIE_ATTRS = `; HttpOnly; SameSite=${COOKIE_SAMESITE}${COOKIE_SECURE_FLAG}; Path=/`;

/** Security headers for auth endpoint responses (mirrors index.ts SECURITY_HEADERS). */
const AUTH_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  ...(IS_HTTPS ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
};

// --- Types ---

export interface User {
  id: string;            // WorkOS user ID (user_01...)
  login: string;         // email address
  name: string;
  email: string;
  avatarUrl: string;
  githubUsername: string | null;
  tier: 'free' | 'pro' | 'team' | 'enterprise';
  orgId: string | null;  // null = no org membership
  role: 'owner' | 'admin' | 'member';
  apiKey: string;        // clt_<random> generated on first login
  preferredProvider: string | null; // User's preferred AI provider
  _teamKeyAuth?: boolean; // true when authenticated via team API key (restricted permissions)
  createdAt: string;
  lastLoginAt: string;
}

export interface Org {
  id: string;
  name: string;
  slug: string;         // URL-safe name
  ownerId: string;      // User.id
  tier: 'team' | 'enterprise';
  maxSeats: number;
  requireSeparateApprover: boolean;
  members: OrgMember[];
  createdAt: string;
}

export interface OrgMember {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

interface AuthStore {
  users: Record<string, User>;       // keyed by User.id
  orgs: Record<string, Org>;         // keyed by Org.id
  apiKeyIndex: Record<string, string>; // apiKey → userId (reverse lookup)
}

// --- OAuth State CSRF protection ---
interface PendingState { ts: number; returnTo?: string; }
const pendingStates = new Map<string, PendingState>(); // state → {timestamp, returnTo}
const STATE_TTL = 600_000; // 10 minutes
const MAX_PENDING_STATES = 50_000;

// Prune expired states periodically
setInterval(() => {
  const now = Date.now();
  for (const [state, { ts }] of pendingStates) {
    if (now - ts > STATE_TTL) pendingStates.delete(state);
  }
}, 120_000).unref();

// --- Store ---

const store: AuthStore = { users: {}, orgs: {}, apiKeyIndex: {} };

export function loadAuthStore(): void {
  try {
    if (existsSync(AUTH_STORE_PATH)) {
      const data = JSON.parse(readFileSync(AUTH_STORE_PATH, 'utf-8'));
      if (data.users) store.users = data.users;
      if (data.orgs) store.orgs = data.orgs;
      if (data.apiKeyIndex) store.apiKeyIndex = data.apiKeyIndex;
      // Migrate plaintext apiKeyIndex to hashed keys
      let migrated = false;
      for (const [key, userId] of Object.entries(store.apiKeyIndex)) {
        if (!key.startsWith('sha256:')) {
          delete store.apiKeyIndex[key];
          store.apiKeyIndex[`sha256:${hashApiKey(key)}`] = userId as string;
          migrated = true;
        }
      }
      if (migrated) saveAuthStore();
      log.info({ users: Object.keys(store.users).length, orgs: Object.keys(store.orgs).length }, 'Loaded auth store');
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Failed to load auth store');
  }
}

function saveAuthStore(): void {
  try {
    const tmp = AUTH_STORE_PATH + '.tmp';
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    renameSync(tmp, AUTH_STORE_PATH);
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Failed to save auth store');
  }
}

loadAuthStore();

// Loud warning if file-backed auth store is used in production
if (!useDb && process.env['NODE_ENV'] === 'production') {
  log.error(
    'PRODUCTION WARNING: Running with file-backed auth store (no DATABASE_URL). ' +
    'User data WILL be lost on container restart. Set DATABASE_URL for production.',
  );
}

// --- Token revocation (LRU cache + DB-backed) ---
const revokedTokensCache = new Map<string, number>(); // hash → last-access timestamp
const MAX_REVOKED_CACHE = 5000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function isTokenRevoked(token: string): Promise<boolean> {
  const h = hashToken(token);
  if (revokedTokensCache.has(h)) {
    // LRU: update access time
    revokedTokensCache.delete(h);
    revokedTokensCache.set(h, Date.now());
    return true;
  }
  return dbIsTokenRevoked(h);
}

async function revokeToken(token: string, userId: string): Promise<void> {
  const h = hashToken(token);
  revokedTokensCache.set(h, Date.now());
  if (revokedTokensCache.size > MAX_REVOKED_CACHE) {
    // Evict least-recently-used (oldest by Map insertion order after LRU re-inserts)
    const first = revokedTokensCache.keys().next().value;
    if (first) revokedTokensCache.delete(first);
  }
  // Revoke until the token's natural expiry (7 days)
  const expiresAt = new Date(Date.now() + JWT_EXPIRY * 1000);
  await dbRevokeToken(h, userId, expiresAt);
}

// --- JWT ---

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

export function createJWT(userId: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    sub: userId,
    iat: now,
    exp: now + JWT_EXPIRY,
  }));
  const signature = base64url(
    createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
}

export function verifyJWT(token: string): { sub: string; iat: number } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = base64url(
    createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  );

  // Constant-time comparison using crypto.timingSafeEqual
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, signatureBuf)) return null;

  try {
    const headerData = JSON.parse(base64urlDecode(header));
    if (headerData.alg !== 'HS256') return null;
    const data = JSON.parse(base64urlDecode(payload));
    if (!data.sub || typeof data.sub !== 'string') return null;
    if (!data.exp || typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: data.sub, iat: data.iat || 0 };
  } catch {
    return null;
  }
}

// --- User Resolution from Request ---

/**
 * Extract authenticated user from request (JWT cookie or Bearer token / API key).
 */
export async function resolveUser(req: IncomingMessage): Promise<User | null> {
  // Try JWT from cookie first
  const cookies = parseCookies(req.headers['cookie'] || '');
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (sessionToken) {
    const jwt = verifyJWT(sessionToken);
    if (jwt) {
      // Check if token has been revoked (logout / key rotation)
      if (await isTokenRevoked(sessionToken)) return null;
      const user = await getUser(jwt.sub);
      if (!user) return null;
      // Check bulk revocation — reject tokens issued before the cutoff
      const revokedBefore = await dbGetTokensRevokedBefore(jwt.sub);
      if (revokedBefore && jwt.iat < Math.floor(revokedBefore.getTime() / 1000)) return null;
      return user;
    }
  }

  // Try API key from Authorization header
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer clt_')) {
    const apiKey = authHeader.slice(7);
    // Check personal API key first
    const user = await getUserByApiKey(apiKey);
    if (user) return user;
    // Check team API keys — resolve to the org owner with restricted role
    if (useDb) {
      const teamKey = await dbGetTeamApiKeyByKey(apiKey);
      if (teamKey) {
        const org = await dbGetOrg(teamKey.org_id);
        if (org) {
          const owner = await getUser(org.owner_id);
          if (owner) {
            // Return a copy with member role to prevent privilege escalation
            // Team keys should only grant generation access, not owner admin rights
            return { ...owner, role: 'member' as const, _teamKeyAuth: true };
          }
        }
      }
    }
  }

  return null;
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  }
  return cookies;
}

// --- User CRUD ---

export async function getUser(id: string): Promise<User | null> {
  if (useDb) {
    const row = await dbGetUser(id);
    return row ? dbUserToUser(row) : null;
  }
  return store.users[id] || null;
}

export async function getUserByApiKey(apiKey: string): Promise<User | null> {
  if (useDb) {
    const row = await dbGetUserByApiKey(apiKey);
    return row ? dbUserToUser(row) : null;
  }
  const keyHash = `sha256:${hashApiKey(apiKey)}`;
  const userId = store.apiKeyIndex[keyHash];
  return userId ? store.users[userId] || null : null;
}

function dbUserToUser(row: DbUser): User {
  return {
    id: row.id, login: row.login, name: row.name, email: row.email,
    avatarUrl: row.avatar_url,
    githubUsername: row.github_username || null,
    tier: row.tier as User['tier'], orgId: row.org_id, role: row.role as User['role'],
    apiKey: row.api_key,
    preferredProvider: row.preferred_provider || null,
    createdAt: row.created_at.toISOString(),
    lastLoginAt: row.last_login_at.toISOString(),
  };
}

export function getEffectiveTier(user: User): User['tier'] {
  return user.tier;
}

/**
 * Resolve the user's plan (e.g. 'pro', 'team') from subscription.
 * Team plans use a single 'team' tier with dynamic seat count.
 * Falls back to deriving from org membership for in-memory mode.
 */
export async function getUserPlan(user: User): Promise<string> {
  if (useDb) {
    const sub = await dbGetSubscription(user.id);
    if (sub) return sub.plan;
  }
  // Fallback: any org membership implies the team plan
  if (user.orgId) {
    const org = await getOrg(user.orgId);
    if (org) return 'team';
  }
  return user.tier;
}

export function generateApiKey(): string {
  return 'clt_' + randomBytes(24).toString('hex');
}

async function createOrUpdateUser(woUser: WorkOSUser): Promise<User> {
  const displayName = [woUser.first_name, woUser.last_name].filter(Boolean).join(' ') || woUser.email;

  // Extract GitHub username from WorkOS identity provider if available
  const ghIdentity = woUser.identities?.find(i => i.provider === 'GitHubOAuth' || i.provider === 'github');
  const githubUsername = ghIdentity?.raw_attributes?.login || null;

  if (useDb) {
    const apiKey = generateApiKey();
    const isNew = !(await dbGetUser(woUser.id));
    const row = await dbUpsertUser({
      id: woUser.id, login: woUser.email,
      name: displayName, email: woUser.email,
      avatarUrl: woUser.profile_picture_url || '', apiKey,
      githubUsername,
    });
    const user = dbUserToUser(row);
    if (isNew && user.email) {
      sendWelcome(user.email, user.name || 'there').catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to send welcome email'); });
    }
    // Auto-link any pending GitHub installations for this user
    if (githubUsername && sql) {
      try {
        const linked = await sql`UPDATE github_installations SET user_id = ${user.id} WHERE github_login = ${githubUsername} AND user_id IS NULL`;
        if ((linked as unknown[]).length) log.info({ userId: user.id, githubUsername, count: (linked as unknown[]).length }, 'Auto-linked pending GitHub installations');
      } catch (err) {
        log.error({ err: (err as Error).message, userId: user.id, githubUsername }, 'Failed to auto-link GitHub installations');
      }
    }
    return user;
  }

  const existing = store.users[woUser.id];
  const now = new Date().toISOString();

  if (existing) {
    existing.login = woUser.email;
    existing.name = displayName;
    existing.email = woUser.email;
    existing.avatarUrl = woUser.profile_picture_url || existing.avatarUrl;
    if (githubUsername) existing.githubUsername = githubUsername;
    existing.lastLoginAt = now;
    saveAuthStore();
    return existing;
  }

  const user: User = {
    id: woUser.id, login: woUser.email,
    name: displayName, email: woUser.email,
    avatarUrl: woUser.profile_picture_url || '', tier: 'free',
    githubUsername,
    orgId: null, role: 'member',
    apiKey: generateApiKey(),
    preferredProvider: null,
    createdAt: now, lastLoginAt: now,
  };

  store.users[user.id] = user;
  store.apiKeyIndex[`sha256:${hashApiKey(user.apiKey)}`] = user.id;
  saveAuthStore();
  return user;
}

// --- Org CRUD ---

export async function getOrg(id: string): Promise<Org | null> {
  if (useDb) {
    const row = await dbGetOrg(id);
    return row ? dbOrgToOrg(row) : null;
  }
  return store.orgs[id] || null;
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  if (useDb) {
    const row = await dbGetOrgBySlug(slug);
    return row ? dbOrgToOrg(row) : null;
  }
  for (const org of Object.values(store.orgs)) {
    if (org.slug === slug) return org;
  }
  return null;
}

function dbOrgToOrg(row: DbOrg): Org {
  return {
    id: row.id, name: row.name, slug: row.slug,
    ownerId: row.owner_id, tier: row.tier as Org['tier'],
    maxSeats: row.max_seats, requireSeparateApprover: row.require_separate_approver,
    members: [], createdAt: row.created_at.toISOString(),
  };
}

export async function createOrg(name: string, owner: User, maxSeats = 10): Promise<Org> {
  const id = randomBytes(12).toString('hex');
  let slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 48);
  const now = new Date().toISOString();

  if (useDb) {
    // Retry with random suffix on slug collision (ON CONFLICT returns no rows)
    let row: ReturnType<typeof dbCreateOrg> extends Promise<infer T> ? T : never;
    for (let attempt = 0; attempt < 3; attempt++) {
      const trySlug = attempt === 0 ? slug : `${slug.slice(0, 40)}-${randomBytes(4).toString('hex')}`;
      row = await dbCreateOrg({ id, name, slug: trySlug, ownerId: owner.id, tier: 'team', maxSeats });
      if (row) { break; }
    }
    if (!row!) throw new Error('Failed to create org — slug conflict after retries');
    await dbAddOrgMember(id, owner.id, 'owner');
    await dbUpdateUserOrg(owner.id, id, 'owner', 'team');
    return dbOrgToOrg(row!);
  }

  // Ensure slug uniqueness by appending random suffix on collision
  const existing = await getOrgBySlug(slug);
  if (existing) {
    slug = `${slug.slice(0, 40)}-${randomBytes(4).toString('hex')}`;
  }

  const org: Org = {
    id, name, slug, ownerId: owner.id, tier: 'team', maxSeats,
    requireSeparateApprover: false,
    members: [{ userId: owner.id, role: 'owner', joinedAt: now }],
    createdAt: now,
  };

  store.orgs[id] = org;
  owner.orgId = id;
  owner.role = 'owner';
  owner.tier = 'team';
  saveAuthStore();
  return org;
}

export async function updateOrgMaxSeats(orgId: string, maxSeats: number): Promise<void> {
  if (useDb) {
    await dbUpdateOrgMaxSeats(orgId, maxSeats);
    return;
  }
  const org = store.orgs[orgId];
  if (org) {
    org.maxSeats = maxSeats;
    saveAuthStore();
  }
}

export async function addOrgMember(orgId: string, user: User, role: 'admin' | 'member' = 'member'): Promise<boolean> {
  if (useDb) {
    const org = await dbGetOrg(orgId);
    if (!org) return false;
    // Atomic seat check + insert to prevent race condition
    const ok = await dbAddOrgMemberAtomic(orgId, user.id, role, org.max_seats);
    if (!ok) return false;
    await dbUpdateUserOrg(user.id, orgId, role, org.tier);
    return true;
  }

  const org = store.orgs[orgId];
  if (!org) return false;
  if (org.members.length >= org.maxSeats) return false;
  if (org.members.some(m => m.userId === user.id)) return false;

  org.members.push({ userId: user.id, role, joinedAt: new Date().toISOString() });
  user.orgId = orgId;
  user.role = role;
  user.tier = org.tier;
  saveAuthStore();
  return true;
}

export async function removeOrgMember(orgId: string, userId: string): Promise<boolean> {
  if (useDb) {
    const org = await dbGetOrg(orgId);
    if (!org || org.owner_id === userId) return false;
    const ok = await dbRemoveOrgMember(orgId, userId);
    if (!ok) return false;
    await dbUpdateUserOrg(userId, null, 'member', 'free');
    return true;
  }

  const org = store.orgs[orgId];
  if (!org) return false;
  if (org.ownerId === userId) return false;

  const idx = org.members.findIndex(m => m.userId === userId);
  if (idx < 0) return false;

  org.members.splice(idx, 1);
  const user = store.users[userId];
  if (user) {
    user.orgId = null;
    user.role = 'member';
    user.tier = 'free';
  }
  saveAuthStore();
  return true;
}

export async function getOrgMembers(orgId: string): Promise<User[]> {
  if (useDb) {
    const rows = await dbGetOrgMembers(orgId);
    return rows.map(dbUserToUser);
  }
  const org = store.orgs[orgId];
  if (!org) return [];
  return org.members
    .map(m => store.users[m.userId])
    .filter((u): u is User => !!u);
}

// --- WorkOS AuthKit Handlers ---

interface WorkOSUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
  identities?: Array<{
    type: string;
    provider: string;
    raw_attributes?: { login?: string };
  }>;
}

/**
 * GET /auth/login — Redirect to WorkOS AuthKit hosted login
 */
export function handleAuthRedirect(req: IncomingMessage, res: ServerResponse): void {
  if (!WORKOS_CLIENT_ID) {
    res.writeHead(500, { 'Content-Type': 'application/json', ...AUTH_SECURITY_HEADERS });
    res.end(JSON.stringify({ error: 'WorkOS AuthKit not configured (WORKOS_CLIENT_ID missing)' }));
    return;
  }

  if (pendingStates.size >= MAX_PENDING_STATES) {
    res.writeHead(503, { 'Content-Type': 'application/json', ...AUTH_SECURITY_HEADERS });
    res.end(JSON.stringify({ error: 'Too many pending OAuth requests. Try again later.' }));
    return;
  }

  // Accept ?returnTo= so callers can resume after login (e.g. pricing checkout)
  const loginUrl = new URL(req.url || '/', `http://localhost`);
  const rawReturnTo = loginUrl.searchParams.get('returnTo') || '';
  // Only allow relative paths on DASHBOARD_URL to prevent open-redirect
  const returnTo = rawReturnTo && /^\/[^/\\]/.test(rawReturnTo) ? rawReturnTo : '';

  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, { ts: Date.now(), returnTo });

  const params = new URLSearchParams({
    client_id: WORKOS_CLIENT_ID,
    redirect_uri: `${BASE_URL}/auth/callback`,
    response_type: 'code',
    provider: 'authkit',
    state,
  });

  res.writeHead(302, { Location: `https://api.workos.com/user_management/authorize?${params}` });
  res.end();
}

/**
 * GET /auth/callback — Handle WorkOS AuthKit callback
 */
export async function handleAuthCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // Validate CSRF state
  if (!state || !pendingStates.has(state)) {
    res.writeHead(400, { 'Content-Type': 'application/json', ...AUTH_SECURITY_HEADERS });
    res.end(JSON.stringify({ error: 'Invalid or expired OAuth state' }));
    return;
  }
  const pendingData = pendingStates.get(state)!;
  pendingStates.delete(state);

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'application/json', ...AUTH_SECURITY_HEADERS });
    res.end(JSON.stringify({ error: 'Missing authorization code' }));
    return;
  }

  try {
    // Exchange code for user profile via WorkOS User Management API
    const tokenRes = await fetch('https://api.workos.com/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: WORKOS_CLIENT_ID,
        client_secret: WORKOS_API_KEY,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      log.warn({ status: tokenRes.status, body: errBody }, 'WorkOS code exchange failed');
      res.writeHead(401, { 'Content-Type': 'application/json', ...AUTH_SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Authentication failed' }));
      return;
    }

    const data = await tokenRes.json() as { user?: WorkOSUser };
    if (!data.user?.id || !data.user?.email) {
      res.writeHead(502, { 'Content-Type': 'application/json', ...AUTH_SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Invalid user profile from WorkOS' }));
      return;
    }

    // Create or update user
    const user = await createOrUpdateUser(data.user);

    // Issue JWT and set cookie
    const jwt = createJWT(user.id);
    const maxAge = JWT_EXPIRY;

    const redirectPath = pendingData.returnTo || '/dashboard.html';
    res.writeHead(302, {
      Location: `${DASHBOARD_URL}${redirectPath}`,
      'Set-Cookie': `${SESSION_COOKIE_NAME}=${jwt}${COOKIE_ATTRS}; Max-Age=${maxAge}`,
      ...AUTH_SECURITY_HEADERS,
    });
    res.end();
  } catch (err) {
    log.error({ err: (err as Error).message }, 'OAuth callback error');
    res.writeHead(500, { 'Content-Type': 'application/json', ...AUTH_SECURITY_HEADERS });
    res.end(JSON.stringify({ error: 'OAuth flow failed' }));
  }
}

/**
 * GET /auth/me — Return current user
 */
export async function handleAuthMe(req: IncomingMessage, res: ServerResponse, jsonFn: (r: ServerResponse, s: number, b: unknown) => void): Promise<void> {
  const user = await resolveUser(req);
  if (!user) {
    jsonFn(res, 401, { error: 'Not authenticated' });
    return;
  }

  const effectiveTier = getEffectiveTier(user);

  jsonFn(res, 200, {
    id: user.id,
    login: user.login,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    githubUsername: user.githubUsername,
    tier: user.tier,
    effectiveTier,
    orgId: user.orgId,
    role: user.role,
    hasApiKey: !!user.apiKey || !!user.apiKeyHash,
    preferredProvider: user.preferredProvider,
    features: getFeatureGating(effectiveTier),
    createdAt: user.createdAt,
  });
}

/**
 * Update a user's preferred AI provider.
 */
export async function updatePreferredProvider(userId: string, provider: string): Promise<void> {
  if (useDb) {
    await dbUpdatePreferredProvider(userId, provider);
  } else {
    const user = store.users[userId];
    if (user) {
      user.preferredProvider = provider;
      saveAuthStore();
    }
  }
}

/**
 * PATCH /auth/me — Update user settings (currently: preferredProvider only).
 */
export async function handleUpdateMe(req: IncomingMessage, res: ServerResponse, jsonFn: (r: ServerResponse, s: number, b: unknown) => void): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { jsonFn(res, 401, { error: 'Not authenticated' }); return; }

  // Provider preference endpoint — no tier restriction (Basic tier was removed)

  let body: string;
  try { body = await readBody(req); } catch { jsonFn(res, 413, { error: 'Request body too large' }); return; }

  let parsed: { preferredProvider?: string };
  try { parsed = JSON.parse(body); } catch { jsonFn(res, 400, { error: 'Invalid JSON' }); return; }

  if (typeof parsed.preferredProvider !== 'string' || !parsed.preferredProvider.trim()) {
    jsonFn(res, 400, { error: 'preferredProvider must be a non-empty string' });
    return;
  }

  const provider = parsed.preferredProvider.trim();
  if (provider === 'none' || !AI_PROVIDERS.includes(provider as typeof AI_PROVIDERS[number])) {
    jsonFn(res, 400, { error: `Invalid provider. Must be one of: ${AI_PROVIDERS.filter(p => p !== 'none').join(', ')}` });
    return;
  }

  await updatePreferredProvider(user.id, provider);
  jsonFn(res, 200, { ok: true, preferredProvider: provider });
}

/**
 * POST /auth/logout — Clear session cookie and revoke the JWT server-side.
 */
export function handleAuthLogout(req: IncomingMessage, res: ServerResponse, jsonFn: (r: ServerResponse, s: number, b: unknown) => void): void {
  // Revoke the current JWT so it can't be reused
  const cookies = parseCookies(req.headers['cookie'] || '');
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (sessionToken) {
    const jwt = verifyJWT(sessionToken);
    if (jwt) {
      revokeToken(sessionToken, jwt.sub).catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to revoke token'); });
    }
  }
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${COOKIE_ATTRS}; Max-Age=0`);
  jsonFn(res, 200, { ok: true });
}

/**
 * POST /auth/rotate-key — Generate a new API key, invalidating the old one.
 */
export async function handleRotateApiKey(req: IncomingMessage, res: ServerResponse, jsonFn: (r: ServerResponse, s: number, b: unknown) => void): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { jsonFn(res, 401, { error: 'Not authenticated' }); return; }
  const newApiKey = generateApiKey();
  if (useDb) {
    await dbRotateApiKey(user.id, newApiKey);
    await dbRevokeAllUserTokens(user.id);
  } else {
    const existing = store.users[user.id];
    if (existing) {
      delete store.apiKeyIndex[`sha256:${hashApiKey(existing.apiKey)}`];
      existing.apiKey = newApiKey;
      store.apiKeyIndex[`sha256:${hashApiKey(newApiKey)}`] = user.id;
      saveAuthStore();
    }
  }
  log.info({ userId: user.id }, 'API key rotated');
  jsonFn(res, 200, { apiKey: newApiKey });
}

/**
 * DELETE /auth/me — GDPR: Delete current user's account and all associated data.
 */
export async function handleDeleteAccount(req: IncomingMessage, res: ServerResponse, jsonFn: (r: ServerResponse, s: number, b: unknown) => void): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { jsonFn(res, 401, { error: 'Not authenticated' }); return; }

  // Org owners must transfer or delete the org before deleting their account
  if (user.orgId && user.role === 'owner') {
    jsonFn(res, 409, { error: 'You must transfer org ownership or delete the org before deleting your account.' });
    return;
  }

  if (useDb) {
    await dbDeleteUser(user.id);
  } else {
    // File-backed fallback: remove from in-memory store
    delete store.apiKeyIndex[`sha256:${hashApiKey(user.apiKey)}`];
    delete store.users[user.id];
    saveAuthStore();
  }

  // Clear session cookie
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${COOKIE_ATTRS}; Max-Age=0`);
  log.info({ userId: user.id }, 'Account deleted (GDPR)');
  jsonFn(res, 200, { ok: true, message: 'Account and all associated data have been deleted.' });
}

/**
 * POST /v1/license/validate — Validate an API key and return the user's actual tier.
 * Called by the CLI/GitHub Action when CULLIT_LICENSE_URL is configured.
 */
export async function handleLicenseValidate(req: IncomingMessage, res: ServerResponse, jsonFn: (r: ServerResponse, s: number, b: unknown) => void): Promise<void> {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer clt_')) {
    jsonFn(res, 401, { valid: false, tier: 'free', message: 'Missing or invalid API key' });
    return;
  }
  const apiKey = authHeader.slice(7);
  const user = await getUserByApiKey(apiKey);
  if (!user) {
    jsonFn(res, 401, { valid: false, tier: 'free', message: 'Invalid API key' });
    return;
  }
  const tier = getEffectiveTier(user);
  jsonFn(res, 200, { valid: true, tier });
}
