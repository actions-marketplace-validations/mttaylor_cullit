/**
 * Cullit Auth Module
 *
 * GitHub OAuth 2.0 login + JWT session tokens.
 * Stores users in file-backed JSON (same pattern as changelog store).
 *
 * Flow:
 *   1. GET /auth/github       → redirect to GitHub OAuth consent
 *   2. GET /auth/callback     → exchange code for token, create/update user, issue JWT
 *   3. GET /auth/me           → return current user from JWT
 *   4. POST /auth/logout      → invalidate session (client clears cookie)
 *
 * Environment Variables:
 *   GITHUB_CLIENT_ID       — GitHub OAuth App client ID
 *   GITHUB_CLIENT_SECRET   — GitHub OAuth App client secret
 *   CULLIT_JWT_SECRET       — Secret for signing JWTs (min 32 chars)
 *   CULLIT_AUTH_STORE_PATH  — Path to auth store JSON (default: ./auth-store.json)
 *   CULLIT_BASE_URL         — Public base URL for callbacks (default: http://localhost:3000)
 */

import { createHmac, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';

// --- Config ---

const GITHUB_CLIENT_ID = process.env['GITHUB_CLIENT_ID'] || '';
const GITHUB_CLIENT_SECRET = process.env['GITHUB_CLIENT_SECRET'] || '';
const JWT_SECRET = process.env['CULLIT_JWT_SECRET'] || randomBytes(32).toString('hex');
const AUTH_STORE_PATH = process.env['CULLIT_AUTH_STORE_PATH'] || './auth-store.json';
const BASE_URL = process.env['CULLIT_BASE_URL'] || 'http://localhost:3000';
const JWT_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds
const SESSION_COOKIE_NAME = 'cullit_session';

// --- Types ---

export interface User {
  id: string;            // GitHub user ID (numeric string)
  login: string;         // GitHub username
  name: string;
  email: string;
  avatarUrl: string;
  tier: 'free' | 'pro' | 'team' | 'enterprise';
  orgId: string | null;  // null = no org membership
  role: 'owner' | 'admin' | 'member';
  apiKey: string;        // clt_<random> generated on first login
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
const pendingStates = new Map<string, number>(); // state → timestamp
const STATE_TTL = 600_000; // 10 minutes

// Prune expired states periodically
setInterval(() => {
  const now = Date.now();
  for (const [state, ts] of pendingStates) {
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
      console.log(`Loaded auth store: ${Object.keys(store.users).length} users, ${Object.keys(store.orgs).length} orgs`);
    }
  } catch (err) {
    console.warn('Failed to load auth store:', (err as Error).message);
  }
}

function saveAuthStore(): void {
  try {
    writeFileSync(AUTH_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save auth store:', (err as Error).message);
  }
}

loadAuthStore();

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

export function verifyJWT(token: string): { sub: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = base64url(
    createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  );

  // Constant-time comparison
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) return null;

  try {
    const data = JSON.parse(base64urlDecode(payload));
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: data.sub };
  } catch {
    return null;
  }
}

// --- User Resolution from Request ---

/**
 * Extract authenticated user from request (JWT cookie or Bearer token / API key).
 */
export function resolveUser(req: IncomingMessage): User | null {
  // Try JWT from cookie first
  const cookies = parseCookies(req.headers['cookie'] || '');
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (sessionToken) {
    const jwt = verifyJWT(sessionToken);
    if (jwt && store.users[jwt.sub]) return store.users[jwt.sub];
  }

  // Try API key from Authorization header
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer clt_')) {
    const apiKey = authHeader.slice(7);
    const userId = store.apiKeyIndex[apiKey];
    if (userId && store.users[userId]) return store.users[userId];
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

export function getUser(id: string): User | null {
  return store.users[id] || null;
}

export function getUserByApiKey(apiKey: string): User | null {
  const userId = store.apiKeyIndex[apiKey];
  return userId ? store.users[userId] || null : null;
}

function generateApiKey(): string {
  return 'clt_' + randomBytes(24).toString('hex');
}

function createOrUpdateUser(ghUser: GitHubUser): User {
  const existing = store.users[ghUser.id];
  const now = new Date().toISOString();

  if (existing) {
    // Update login info but preserve tier, org, role, apiKey
    existing.login = ghUser.login;
    existing.name = ghUser.name || existing.name;
    existing.email = ghUser.email || existing.email;
    existing.avatarUrl = ghUser.avatar_url;
    existing.lastLoginAt = now;
    saveAuthStore();
    return existing;
  }

  const user: User = {
    id: ghUser.id,
    login: ghUser.login,
    name: ghUser.name || ghUser.login,
    email: ghUser.email || '',
    avatarUrl: ghUser.avatar_url,
    tier: 'free',
    orgId: null,
    role: 'member',
    apiKey: generateApiKey(),
    createdAt: now,
    lastLoginAt: now,
  };

  store.users[user.id] = user;
  store.apiKeyIndex[user.apiKey] = user.id;
  saveAuthStore();
  return user;
}

// --- Org CRUD ---

export function getOrg(id: string): Org | null {
  return store.orgs[id] || null;
}

export function getOrgBySlug(slug: string): Org | null {
  for (const org of Object.values(store.orgs)) {
    if (org.slug === slug) return org;
  }
  return null;
}

export function createOrg(name: string, owner: User): Org {
  const id = randomBytes(12).toString('hex');
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 48);
  const now = new Date().toISOString();

  const org: Org = {
    id,
    name,
    slug,
    ownerId: owner.id,
    tier: 'team',
    maxSeats: 10,
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

export function addOrgMember(orgId: string, user: User, role: 'admin' | 'member' = 'member'): boolean {
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

export function removeOrgMember(orgId: string, userId: string): boolean {
  const org = store.orgs[orgId];
  if (!org) return false;
  if (org.ownerId === userId) return false; // can't remove owner

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

export function getOrgMembers(orgId: string): User[] {
  const org = store.orgs[orgId];
  if (!org) return [];
  return org.members
    .map(m => store.users[m.userId])
    .filter((u): u is User => !!u);
}

// --- GitHub OAuth Handlers ---

interface GitHubUser {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

/**
 * GET /auth/github — Redirect to GitHub OAuth consent screen
 */
export function handleAuthRedirect(_req: IncomingMessage, res: ServerResponse): void {
  if (!GITHUB_CLIENT_ID) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'GitHub OAuth not configured (GITHUB_CLIENT_ID missing)' }));
    return;
  }

  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${BASE_URL}/auth/callback`,
    scope: 'read:user user:email',
    state,
  });

  res.writeHead(302, { Location: `https://github.com/login/oauth/authorize?${params}` });
  res.end();
}

/**
 * GET /auth/callback — Handle GitHub OAuth callback
 */
export async function handleAuthCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // Validate CSRF state
  if (!state || !pendingStates.has(state)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or expired OAuth state' }));
    return;
  }
  pendingStates.delete(state);

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing authorization code' }));
    return;
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GitHub OAuth failed: ' + (tokenData.error || 'no token') }));
      return;
    }

    // Fetch GitHub user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cullit-api',
      },
    });

    if (!userRes.ok) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch GitHub user profile' }));
      return;
    }

    const ghUser = await userRes.json() as GitHubUser;
    ghUser.id = String(ghUser.id); // Ensure string

    // Create or update user
    const user = createOrUpdateUser(ghUser);

    // Issue JWT and set cookie
    const jwt = createJWT(user.id);
    const maxAge = JWT_EXPIRY;

    res.writeHead(302, {
      Location: `${BASE_URL}/dashboard.html`,
      'Set-Cookie': `${SESSION_COOKIE_NAME}=${jwt}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    });
    res.end();
  } catch (err) {
    console.error('OAuth callback error:', (err as Error).message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'OAuth flow failed' }));
  }
}

/**
 * GET /auth/me — Return current user
 */
export function handleAuthMe(req: IncomingMessage, res: ServerResponse, jsonFn: (r: ServerResponse, s: number, b: unknown) => void): void {
  const user = resolveUser(req);
  if (!user) {
    jsonFn(res, 401, { error: 'Not authenticated' });
    return;
  }

  jsonFn(res, 200, {
    id: user.id,
    login: user.login,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    tier: user.tier,
    orgId: user.orgId,
    role: user.role,
    apiKey: user.apiKey,
    createdAt: user.createdAt,
  });
}

/**
 * POST /auth/logout — Clear session cookie
 */
export function handleAuthLogout(_req: IncomingMessage, res: ServerResponse, jsonFn: (r: ServerResponse, s: number, b: unknown) => void): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  jsonFn(res, 200, { ok: true });
}
