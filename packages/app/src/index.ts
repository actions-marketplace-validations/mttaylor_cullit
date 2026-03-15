/**
 * Cullit GitHub App — Webhook Handler
 *
 * Handles GitHub App webhooks to auto-generate release notes.
 * Designed to run as a standalone server or behind the existing API.
 *
 * Supported Events:
 *   - installation / installation_repositories: Track installs
 *   - release (published/created): Auto-generate notes for releases
 *   - push (tag refs): Auto-generate notes on tag push
 *
 * Environment Variables:
 *   GITHUB_APP_ID         — GitHub App ID
 *   GITHUB_APP_PRIVATE_KEY — PEM private key (base64 or raw)
 *   GITHUB_WEBHOOK_SECRET  — Webhook signature secret
 *   CULLIT_APP_PORT        — Port (default 3001)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { runPipeline, VERSION, DEFAULT_CATEGORIES } from '@cullit/core';
import type { CullConfig } from '@cullit/core';

// Load pro plugins
try { await import('@cullit/pro'); } catch { /* pro not installed */ }

const APP_ID = process.env['GITHUB_APP_ID'] || '';
const PRIVATE_KEY = decodeKey(process.env['GITHUB_APP_PRIVATE_KEY'] || '');
const WEBHOOK_SECRET = process.env['GITHUB_WEBHOOK_SECRET'] || '';
const PORT = parseInt(process.env['CULLIT_APP_PORT'] || '3001', 10);

function decodeKey(key: string): string {
  // Support base64-encoded PEM keys (common in CI/Docker)
  if (key.startsWith('LS0t')) {
    return Buffer.from(key, 'base64').toString('utf-8');
  }
  return key.replace(/\\n/g, '\n');
}

// --- Signature Verification ---

function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// --- GitHub API Helpers ---

interface InstallationToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<number, InstallationToken>();

async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const jwt = await createJWT();
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': `cullit-app/${VERSION}`,
    },
  });

  if (!res.ok) throw new Error(`Failed to get installation token: ${res.status}`);
  const data = await res.json() as { token: string; expires_at: string };

  tokenCache.set(installationId, {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  });

  return data.token;
}

async function createJWT(): Promise<string> {
  if (!APP_ID || !PRIVATE_KEY) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY required');

  // Minimal JWT implementation (RS256)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ iss: APP_ID, iat: now - 60, exp: now + 600 }));

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = base64url(sign.sign(PRIVATE_KEY));

  return `${header}.${payload}.${signature}`;
}

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- GitHub API ---

async function createOrUpdateRelease(
  token: string, owner: string, repo: string,
  tag: string, body: string
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': `cullit-app/${VERSION}`,
  };

  // Check if release already exists
  const existing = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
    { headers }
  );

  if (existing.ok) {
    const release = await existing.json() as { id: number };
    await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    });
    console.log(`Updated release ${tag} on ${owner}/${repo}`);
  } else {
    await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tag_name: tag, name: tag, body }),
    });
    console.log(`Created release ${tag} on ${owner}/${repo}`);
  }
}

async function getPreviousTag(token: string, owner: string, repo: string, currentTag: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/tags?per_page=10`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': `cullit-app/${VERSION}`,
      },
    }
  );

  if (!res.ok) return null;
  const tags = await res.json() as { name: string }[];
  const idx = tags.findIndex(t => t.name === currentTag);
  return idx >= 0 && idx + 1 < tags.length ? tags[idx + 1].name : null;
}

// --- Event Handlers ---

async function handleRelease(payload: any): Promise<void> {
  const { release, repository, installation } = payload;
  if (!release || !repository || !installation) return;

  const action = payload.action;
  if (action !== 'published' && action !== 'created') return;

  const tag = release.tag_name;
  const owner = repository.owner.login;
  const repo = repository.name;
  const installationId = installation.id;

  console.log(`Release ${action}: ${owner}/${repo}@${tag}`);

  const token = await getInstallationToken(installationId);
  const prevTag = await getPreviousTag(token, owner, repo, tag);

  if (!prevTag) {
    console.log(`No previous tag found for ${tag}, skipping`);
    return;
  }

  // Clone and generate
  const config: CullConfig = {
    ai: { provider: 'none', audience: 'developer', tone: 'professional', categories: DEFAULT_CATEGORIES },
    source: { type: 'local' },
    publish: [],
  };

  // Set token so GitCollector can access private repos
  process.env.GITHUB_TOKEN = token;

  const result = await runPipeline(prevTag, tag, config, { format: 'markdown' });

  // Update the release body
  await createOrUpdateRelease(token, owner, repo, tag, result.formatted);
}

async function handlePush(payload: any): Promise<void> {
  const { ref, repository, installation } = payload;
  if (!ref || !repository || !installation) return;

  // Only process tag pushes
  if (!ref.startsWith('refs/tags/')) return;

  const tag = ref.replace('refs/tags/', '');
  const owner = repository.owner.login;
  const repo = repository.name;
  const installationId = installation.id;

  console.log(`Tag push: ${owner}/${repo}@${tag}`);

  const token = await getInstallationToken(installationId);
  const prevTag = await getPreviousTag(token, owner, repo, tag);

  if (!prevTag) {
    console.log(`No previous tag found for ${tag}, skipping`);
    return;
  }

  const config: CullConfig = {
    ai: { provider: 'none', audience: 'developer', tone: 'professional', categories: DEFAULT_CATEGORIES },
    source: { type: 'local' },
    publish: [],
  };

  process.env.GITHUB_TOKEN = token;

  const result = await runPipeline(prevTag, tag, config, { format: 'markdown' });

  // Create a GitHub Release for the tag
  await createOrUpdateRelease(token, owner, repo, tag, result.formatted);
}

function handleInstallation(payload: any): void {
  const action = payload.action;
  const account = payload.installation?.account?.login || 'unknown';
  const repos = payload.repositories?.map((r: any) => r.full_name) || [];

  console.log(`Installation ${action}: ${account} (${repos.length} repos)`);

  if (action === 'created') {
    console.log('  Repos:', repos.join(', '));
  }
}

// --- HTTP Server ---

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 5_242_880) throw new Error('Payload too large'); // 5 MB
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { status: 'ok', app: 'cullit-github-app', version: VERSION });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    json(res, 404, { error: 'Not found' });
    return;
  }

  try {
    const body = await readBody(req);

    // Verify webhook signature
    if (WEBHOOK_SECRET) {
      const sig = req.headers['x-hub-signature-256'] as string;
      if (!verifySignature(body, sig)) {
        json(res, 401, { error: 'Invalid signature' });
        return;
      }
    }

    const event = req.headers['x-github-event'] as string;
    const payload = JSON.parse(body);

    // Respond immediately, process async
    json(res, 200, { ok: true, event });

    // Process in background (don't block the response)
    switch (event) {
      case 'release':
        handleRelease(payload).catch(err =>
          console.error('Release handler error:', err.message));
        break;
      case 'push':
        handlePush(payload).catch(err =>
          console.error('Push handler error:', err.message));
        break;
      case 'installation':
      case 'installation_repositories':
        handleInstallation(payload);
        break;
      default:
        console.log(`Ignored event: ${event}`);
    }
  } catch (err) {
    console.error('Webhook error:', (err as Error).message);
    json(res, 500, { error: 'Internal server error' });
  }
});

// Only start server when run directly (not when imported for testing)
const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.mjs');
if (isDirectRun) {
  server.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════════╗
  ║  Cullit GitHub App v${VERSION}               ║
  ║  http://localhost:${PORT}                    ║
  ║                                           ║
  ║  POST /webhook    GitHub events           ║
  ║  GET  /health     Health check            ║
  ╚═══════════════════════════════════════════╝
    `);
  });
}

export { server, verifySignature, handleRelease, handlePush, handleInstallation };
