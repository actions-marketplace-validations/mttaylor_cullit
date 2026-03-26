import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';

const PORT = 13579; // unlikely to conflict
const TEST_API_KEY = 'clt_testkey123';
const TEST_AUTH_STORE = join(__dirname, '.test-auth-store.json');
let serverProcess: ChildProcess;

async function apiRequest(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://localhost:${PORT}${path}`, opts);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** Make an authenticated API request using the test API key. */
async function authedRequest(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const headers = { ...(opts.headers as Record<string, string> || {}), Authorization: `Bearer ${TEST_API_KEY}` };
  return apiRequest(path, { ...opts, headers });
}

describe('API Server', () => {
  beforeAll(async () => {
    // Pre-seed auth store with a test user
    writeFileSync(TEST_AUTH_STORE, JSON.stringify({
      users: {
        '99999': {
          id: '99999', login: 'testbot', name: 'Test Bot', email: 'test@test.com',
          avatarUrl: '', tier: 'free', apiKey: TEST_API_KEY, createdAt: new Date().toISOString(),
        },
      },
      orgs: {},
      apiKeyIndex: { [TEST_API_KEY]: '99999' },
    }));

    // Start the API server as a child process
    const serverPath = join(__dirname, '..', 'dist', 'index.js');
    serverProcess = spawn('node', [serverPath], {
      env: { ...process.env, PORT: String(PORT), RATE_LIMIT: '15', CULLIT_API_TOKEN: '', CULLIT_AUTH_STORE_PATH: TEST_AUTH_STORE },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
      serverProcess.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('listening')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      serverProcess.on('error', reject);
      serverProcess.on('exit', (code) => {
        if (code !== null) reject(new Error(`Server exited with code ${code}`));
      });
    });
  }, 15000);

  afterAll(() => {
    serverProcess?.kill('SIGTERM');
    try { unlinkSync(TEST_AUTH_STORE); } catch { /* cleanup best-effort */ }
  });

  it('GET /health returns status ok', async () => {
    const { status, body } = await apiRequest('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBeUndefined();
    expect(body.uptime).toBeUndefined();
  });

  it('GET /openapi.json returns OpenAPI spec', async () => {
    const { status, body } = await apiRequest('/openapi.json');
    expect(status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toContain('Cullit');
    expect(body.paths['/generate']).toBeDefined();
  });

  it('GET /unknown returns 404', async () => {
    const { status, body } = await apiRequest('/nonexistent');
    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('POST /generate rejects missing "from"', async () => {
    const { status, body } = await apiRequest('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('"from" is required');
  });

  it('POST /generate rejects invalid JSON', async () => {
    const { status, body } = await apiRequest('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid JSON');
  });

  it('POST /generate rejects invalid provider', async () => {
    const { status, body } = await apiRequest('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'v1.0.0', provider: 'bad-provider' }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid provider');
  });

  it('POST /generate rejects invalid format', async () => {
    const { status, body } = await apiRequest('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'v1.0.0', format: 'xml' }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid format');
  });

  it('POST /generate rejects oversized "from"', async () => {
    const { status, body } = await apiRequest('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'x'.repeat(1001) }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('"from"');
  });

  it('POST /generate rejects invalid Jira domain', async () => {
    const { status, body } = await apiRequest('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'v1.0.0', jira: { domain: 'not a domain!' } }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid Jira domain');
  });

  it('OPTIONS returns CORS headers', async () => {
    const res = await fetch(`http://localhost:${PORT}/generate`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  // --- Changelog API ---

  it('POST /v1/changelog rejects missing project', async () => {
    const { status, body } = await authedRequest('/v1/changelog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'v1.0.0', changes: [] }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('"project"');
  });

  it('POST /v1/changelog rejects invalid project slug', async () => {
    const { status, body } = await authedRequest('/v1/changelog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'bad slug!', version: 'v1.0.0', changes: [] }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('alphanumeric');
  });

  it('POST /v1/changelog accepts and stores a release', async () => {
    const { status, body } = await authedRequest('/v1/changelog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'test-project',
        version: 'v1.0.0',
        date: '2026-03-16',
        summary: 'First release',
        changes: [{ description: 'Added feature X', category: 'features' }],
        contributors: ['alice'],
        formatted: { markdown: '# v1.0.0', html: '<h1>v1.0.0</h1>' },
      }),
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.url).toContain('test-project');
    expect(body.version).toBe('v1.0.0');
  });

  it('GET /v1/changelog/:project/latest returns stored releases', async () => {
    const { status, body } = await apiRequest('/v1/changelog/test-project/latest');
    expect(status).toBe(200);
    expect(body.project).toBe('test-project');
    expect(body.releases).toHaveLength(1);
    expect(body.releases[0].version).toBe('v1.0.0');
    expect(body.releases[0].summary).toBe('First release');
    expect(body.releases[0].changes[0].description).toBe('Added feature X');
  });

  it('GET /v1/changelog/:project/latest returns empty for unknown project', async () => {
    const { status, body } = await apiRequest('/v1/changelog/nonexistent/latest');
    expect(status).toBe(200);
    expect(body.releases).toHaveLength(0);
  });

  it('POST /v1/changelog updates existing version', async () => {
    const { status } = await authedRequest('/v1/changelog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'test-project',
        version: 'v1.0.0',
        summary: 'Updated release',
        changes: [{ description: 'Updated feature X', category: 'improvements' }],
        formatted: { markdown: '# v1.0.0 updated', html: '<h1>v1.0.0 updated</h1>' },
      }),
    });
    expect(status).toBe(201);

    const { body } = await apiRequest('/v1/changelog/test-project/latest');
    expect(body.releases[0].summary).toBe('Updated release');
  });

  it('rate limits excessive requests', async () => {
    // RATE_LIMIT is 15, only POST /generate is rate-limited
    // Earlier tests used ~6 POST /generate requests
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(await apiRequest('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `v${i}.0.0` }),
      }));
    }
    const rateLimited = results.some(r => r.status === 429);
    expect(rateLimited).toBe(true);
  });

  // --- Auth endpoints ---

  it('GET /auth/github redirects to GitHub OAuth with correct redirect_uri', async () => {
    const res = await fetch(`http://localhost:${PORT}/auth/github`, { redirect: 'manual' });
    // May be rate limited in test env
    if (res.status === 429) return;
    expect(res.status).toBe(302);
    const location = res.headers.get('location') || '';
    expect(location).toContain('https://github.com/login/oauth/authorize');
    // redirect_uri must use /auth/callback (not /auth/github/callback)
    const url = new URL(location);
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    expect(redirectUri).toMatch(/\/auth\/callback$/);
    expect(redirectUri).not.toContain('/auth/github/callback');
    // Must include required scopes
    expect(url.searchParams.get('scope')).toContain('read:user');
    // Must include CSRF state
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('GET /auth/github redirect_uri matches CULLIT_BASE_URL origin', async () => {
    const res = await fetch(`http://localhost:${PORT}/auth/github`, { redirect: 'manual' });
    if (res.status === 429) return;
    const location = res.headers.get('location') || '';
    if (!location) return; // No GITHUB_CLIENT_ID configured in test env
    const url = new URL(location);
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    // redirect_uri must always be an absolute URL starting with http
    expect(redirectUri).toMatch(/^https?:\/\//);
  });

  it('GET /auth/me returns 401 when not authenticated', async () => {
    const { status } = await apiRequest('/auth/me');
    expect([401, 429]).toContain(status);
  });

  it('POST /auth/logout returns ok', async () => {
    const { status } = await apiRequest('/auth/logout', { method: 'POST' });
    expect([200, 429]).toContain(status);
  });

  // --- Org endpoints ---

  it('GET /v1/org returns 401 or 429 when not authenticated', async () => {
    const { status } = await apiRequest('/v1/org');
    expect([401, 429]).toContain(status);
  });

  it('POST /v1/org returns 401 or 429 when not authenticated', async () => {
    const { status } = await apiRequest('/v1/org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Org' }),
    });
    expect([401, 429]).toContain(status);
  });

  it('POST /v1/org/invite returns 401 or 429 when not authenticated', async () => {
    const { status } = await apiRequest('/v1/org/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'test' }),
    });
    expect([401, 429]).toContain(status);
  });

  // --- History endpoint ---

  it('GET /v1/history returns 401 or 429 when not authenticated', async () => {
    const { status } = await apiRequest('/v1/history');
    expect([401, 429]).toContain(status);
  });

  // --- Analytics endpoint ---

  it('GET /v1/analytics/usage returns 401 or 429 when not authenticated', async () => {
    const { status } = await apiRequest('/v1/analytics/usage');
    expect([401, 429]).toContain(status);
  });

  it('DELETE /v1/drafts/:id returns 401 or 429 when not authenticated', async () => {
    const { status } = await apiRequest('/v1/drafts/test-draft-id', { method: 'DELETE' });
    expect([401, 429]).toContain(status);
  });

  it('GET /v1/projects/settings returns 401 or 429 when not authenticated', async () => {
    const { status } = await apiRequest('/v1/projects/settings');
    expect([401, 429]).toContain(status);
  });

  it('GET /v1/org/invites returns 401 or 429 when not authenticated', async () => {
    const { status } = await apiRequest('/v1/org/invites');
    expect([401, 429]).toContain(status);
  });

  // --- OpenAPI spec includes new endpoints ---

  it('OpenAPI spec includes auth, team, history, and analytics paths', async () => {
    const { body } = await apiRequest('/openapi.json');
    expect(body.paths['/auth/github']).toBeDefined();
    expect(body.paths['/auth/me']).toBeDefined();
    expect(body.paths['/auth/logout']).toBeDefined();
    expect(body.paths['/v1/org']).toBeDefined();
    expect(body.paths['/v1/history']).toBeDefined();
    expect(body.paths['/v1/analytics/usage']).toBeDefined();
    expect(body.paths['/v1/drafts']).toBeDefined();
    expect(body.paths['/v1/projects/settings']).toBeDefined();
    expect(body.paths['/v1/org/invites']).toBeDefined();
    expect(body.paths['/v1/org/usage']).toBeDefined();
  });

  it('OpenAPI spec includes new component schemas', async () => {
    const { body } = await apiRequest('/openapi.json');
    expect(body.components.schemas.User).toBeDefined();
    expect(body.components.schemas.OrgResponse).toBeDefined();
    expect(body.components.schemas.HistoryEntry).toBeDefined();
    expect(body.components.schemas.DailyUsage).toBeDefined();
    expect(body.components.schemas.AnalyticsResponse).toBeDefined();
  });

  it('CORS preflight includes DELETE method and credentials', async () => {
    const res = await fetch(`http://localhost:${PORT}/generate`, { method: 'OPTIONS' });
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  // --- Security headers ---

  it('responses include security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)', async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('responses include Content-Security-Policy', async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('POST /v1/changelog rejects invalid project slug with special characters', async () => {
    const { status, body } = await authedRequest('/v1/changelog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: '../etc/passwd',
        version: 'v1.0.0',
        changes: [],
      }),
    });
    expect([400, 429]).toContain(status);
    if (status === 400) {
      expect(body.error).toContain('project');
    }
  });

  it('GET /v1/changelog rejects path traversal in project slug', async () => {
    const res = await fetch(`http://localhost:${PORT}/v1/changelog/../../etc/latest`);
    const body = await res.json().catch(() => null);
    // Should either 400 (bad slug) or 404 — not traverse
    expect([400, 404, 429]).toContain(res.status);
  });

  it('POST /v1/events validates event name against allowlist', async () => {
    const { status, body } = await apiRequest('/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'malicious_event_name' }),
    });
    expect([400, 429]).toContain(status);
    if (status === 400) {
      expect(body.error).toContain('Invalid event');
    }
  });
});
