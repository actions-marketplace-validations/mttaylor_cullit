import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { createHmac } from 'crypto';
import type { Server } from 'http';

describe('GitHub App — HTTP Integration', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-secret');
    vi.stubEnv('CULLIT_APP_PORT', '0'); // random port
  });

  async function startServer(): Promise<{ server: Server; url: string }> {
    vi.resetModules();
    const mod = await import('../src/index');
    const srv = mod.server;
    await new Promise<void>((resolve) => {
      srv.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = srv.address() as { port: number };
    return { server: srv, url: `http://127.0.0.1:${addr.port}` };
  }

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('GET /health returns 200 with status ok', async () => {
    const s = await startServer();
    server = s.server;
    baseUrl = s.url;

    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
    expect(body.app).toBe('cullit-github-app');
    expect(body.version).toBeDefined();

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /unknown returns 404', async () => {
    const s = await startServer();
    server = s.server;
    baseUrl = s.url;

    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /webhook rejects invalid signature', async () => {
    const s = await startServer();
    server = s.server;
    baseUrl = s.url;

    const payload = JSON.stringify({ action: 'published' });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'release',
        'x-hub-signature-256': 'sha256=invalid',
      },
      body: payload,
    });

    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe('Invalid signature');

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /webhook accepts valid signature', async () => {
    const s = await startServer();
    server = s.server;
    baseUrl = s.url;

    const payload = JSON.stringify({
      action: 'created',
      installation: { account: { login: 'test-org' } },
      repositories: [{ full_name: 'test-org/repo' }],
    });

    const sig = 'sha256=' + createHmac('sha256', 'test-secret').update(payload).digest('hex');
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'installation',
        'x-hub-signature-256': sig,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.event).toBe('installation');

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /webhook rejects payloads over 5MB', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', ''); // skip sig check
    vi.resetModules();
    const mod = await import('../src/index');
    server = mod.server;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // 5MB + 1 byte
    const bigPayload = 'x'.repeat(5_242_881);
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'push',
      },
      body: bigPayload,
    });

    expect(res.status).toBe(500);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /webhook handles unknown events gracefully', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', ''); // skip sig check
    vi.resetModules();
    const mod = await import('../src/index');
    server = mod.server;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const payload = JSON.stringify({ action: 'test' });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'unknown_event',
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
