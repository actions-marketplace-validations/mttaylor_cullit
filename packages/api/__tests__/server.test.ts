import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';

const PORT = 13579; // unlikely to conflict
let serverProcess: ChildProcess;

async function apiRequest(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://localhost:${PORT}${path}`, opts);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe('API Server', () => {
  beforeAll(async () => {
    // Start the API server as a child process
    const serverPath = join(__dirname, '..', 'dist', 'index.js');
    serverProcess = spawn('node', [serverPath], {
      env: { ...process.env, PORT: String(PORT), RATE_LIMIT: '15', CULLIT_API_TOKEN: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
      serverProcess.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('localhost')) {
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
  });

  it('GET /health returns status ok', async () => {
    const { status, body } = await apiRequest('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(body.uptime).toBeGreaterThanOrEqual(0);
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
});
