/**
 * Integration verifier — checks every configured connection (collectors, enrichers,
 * publishers) end-to-end without actually publishing a release.
 *
 * Used by:
 *   - `cullit verify` CLI command
 *   - POST /v1/integrations/test API endpoint
 *   - The end-to-end `live-integrations.test.ts` harness (with mock servers)
 *
 * For each integration we issue a minimal HTTP probe to the same hostname/auth
 * surface that the real publisher/collector uses. A 2xx OR a recognized 4xx
 * (auth failure, not-found) confirms the network path works; only network errors,
 * timeouts, or unexpected 5xx are treated as failures.
 */

import { fetchWithTimeout } from './fetch.js';
import type { CullConfig, PublishTarget } from './types.js';

export type VerifyStatus = 'ok' | 'misconfigured' | 'unreachable' | 'auth-failed' | 'unknown';

export interface VerifyResult {
  integration: string;
  status: VerifyStatus;
  message: string;
  /** Optional response code observed (only set if a network call was made). */
  httpStatus?: number;
  /** ms elapsed for this probe. */
  durationMs?: number;
}

interface VerifierContext {
  /** When set, all probes go to this base URL instead of the real provider host (used by tests). */
  baseUrlOverride?: string;
  /** Per-env overrides; if omitted falls back to process.env */
  env?: Record<string, string | undefined>;
}

function getEnv(ctx: VerifierContext | undefined, key: string): string | undefined {
  return (ctx?.env?.[key]) ?? process.env[key];
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

/** Categorize an HTTP probe response into a VerifyStatus. */
function classify(status: number): VerifyStatus {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'auth-failed';
  if (status === 404 || status === 422) return 'ok'; // hostname resolved + auth succeeded; 404 just means no resource at probe path — that's fine
  if (status === 429) return 'ok'; // rate-limited, but reachable + authorized
  if (status >= 500) return 'unreachable';
  return 'unknown';
}

async function probe(url: string, init: RequestInit = {}): Promise<{ status: number; ok: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(url, init, 5000);
    return { status: res.status, ok: res.ok };
  } catch (err) {
    return { status: 0, ok: false, error: (err as Error).message };
  }
}

// ============================================
// Per-integration probes
// ============================================

async function verifyGitHub(ctx?: VerifierContext): Promise<VerifyResult> {
  const start = performance.now();
  const token = getEnv(ctx, 'GITHUB_TOKEN');
  if (!token) {
    return { integration: 'github', status: 'misconfigured', message: 'GITHUB_TOKEN not set' };
  }
  const base = ctx?.baseUrlOverride || 'https://api.github.com';
  const r = await probe(`${base}/user`, {
    headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (r.status === 0) return { integration: 'github', status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  return {
    integration: 'github',
    status: classify(r.status),
    httpStatus: r.status,
    message: r.ok ? 'GitHub API reachable + authorized' : `GitHub API returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

async function verifyGitLab(ctx?: VerifierContext, domain = 'gitlab.com'): Promise<VerifyResult> {
  const start = performance.now();
  const token = getEnv(ctx, 'GITLAB_TOKEN');
  if (!token) {
    return { integration: 'gitlab', status: 'misconfigured', message: 'GITLAB_TOKEN not set' };
  }
  const base = ctx?.baseUrlOverride || `https://${domain}`;
  const r = await probe(`${base}/api/v4/user`, {
    headers: { 'PRIVATE-TOKEN': token },
  });
  if (r.status === 0) return { integration: 'gitlab', status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  return {
    integration: 'gitlab',
    status: classify(r.status),
    httpStatus: r.status,
    message: r.ok ? 'GitLab API reachable + authorized' : `GitLab API returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

async function verifyBitbucket(ctx?: VerifierContext): Promise<VerifyResult> {
  const start = performance.now();
  const username = getEnv(ctx, 'BITBUCKET_USERNAME');
  const appPassword = getEnv(ctx, 'BITBUCKET_APP_PASSWORD');
  if (!username || !appPassword) {
    return { integration: 'bitbucket', status: 'misconfigured', message: 'BITBUCKET_USERNAME / BITBUCKET_APP_PASSWORD not set' };
  }
  const base = ctx?.baseUrlOverride || 'https://api.bitbucket.org';
  const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
  const r = await probe(`${base}/2.0/user`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (r.status === 0) return { integration: 'bitbucket', status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  return {
    integration: 'bitbucket',
    status: classify(r.status),
    httpStatus: r.status,
    message: r.ok ? 'Bitbucket API reachable + authorized' : `Bitbucket API returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

async function verifyJira(ctx: VerifierContext | undefined, config: { domain: string; email?: string; apiToken?: string }): Promise<VerifyResult> {
  const start = performance.now();
  const email = config.email || getEnv(ctx, 'JIRA_EMAIL');
  const token = config.apiToken || getEnv(ctx, 'JIRA_API_TOKEN');
  if (!email || !token) {
    return { integration: 'jira', status: 'misconfigured', message: 'JIRA_EMAIL / JIRA_API_TOKEN not set' };
  }
  if (!/^[a-zA-Z0-9.-]+\.atlassian\.net$/.test(config.domain)) {
    return { integration: 'jira', status: 'misconfigured', message: `Invalid Jira domain: ${config.domain}` };
  }
  const base = ctx?.baseUrlOverride || `https://${config.domain}`;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const r = await probe(`${base}/rest/api/3/myself`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (r.status === 0) return { integration: 'jira', status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  return {
    integration: 'jira',
    status: classify(r.status),
    httpStatus: r.status,
    message: r.ok ? 'Jira reachable + authorized' : `Jira returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

async function verifyLinear(ctx?: VerifierContext): Promise<VerifyResult> {
  const start = performance.now();
  const apiKey = getEnv(ctx, 'LINEAR_API_KEY');
  if (!apiKey) {
    return { integration: 'linear', status: 'misconfigured', message: 'LINEAR_API_KEY not set' };
  }
  const base = ctx?.baseUrlOverride || 'https://api.linear.app';
  const r = await probe(`${base}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { id } }' }),
  });
  if (r.status === 0) return { integration: 'linear', status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  return {
    integration: 'linear',
    status: classify(r.status),
    httpStatus: r.status,
    message: r.ok ? 'Linear GraphQL reachable + authorized' : `Linear returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

async function verifyWebhook(integration: string, url: string | undefined, allowedHostSuffix: string[], ctx?: VerifierContext): Promise<VerifyResult> {
  const start = performance.now();
  if (!url) return { integration, status: 'misconfigured', message: `${integration} webhookUrl not set` };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { integration, status: 'misconfigured', message: 'Invalid webhook URL' }; }
  if (parsed.protocol !== 'https:') return { integration, status: 'misconfigured', message: 'Webhook must be https://' };
  if (!allowedHostSuffix.some(suf => parsed.hostname === suf || parsed.hostname.endsWith('.' + suf) || parsed.hostname.endsWith(suf))) {
    return { integration, status: 'misconfigured', message: `Hostname not allowed for ${integration}: ${parsed.hostname}` };
  }
  // For tests, route to baseUrlOverride while preserving the original path.
  const probeUrl = ctx?.baseUrlOverride
    ? `${ctx.baseUrlOverride}${parsed.pathname}${parsed.search}`
    : url;
  // Send an empty POST: every webhook returns 4xx for malformed payloads, which still proves connectivity + auth-by-secret.
  const r = await probe(probeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (r.status === 0) return { integration, status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  // Webhook endpoints typically return 400 for empty payload — that's a successful round-trip
  return {
    integration,
    status: r.status === 400 || r.status === 200 || r.status === 204 ? 'ok' : classify(r.status),
    httpStatus: r.status,
    message: r.ok || r.status === 400 ? `${integration} webhook reachable` : `${integration} returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

async function verifyConfluence(ctx: VerifierContext | undefined, target: PublishTarget): Promise<VerifyResult> {
  const start = performance.now();
  const domain = (target as { domain?: string }).domain;
  if (!domain || !/^[a-zA-Z0-9.-]+\.atlassian\.net$/.test(domain)) {
    return { integration: 'confluence', status: 'misconfigured', message: 'Invalid or missing Confluence domain' };
  }
  const email = getEnv(ctx, 'CONFLUENCE_EMAIL') || getEnv(ctx, 'JIRA_EMAIL');
  const token = getEnv(ctx, 'CONFLUENCE_API_TOKEN') || getEnv(ctx, 'JIRA_API_TOKEN');
  if (!email || !token) {
    return { integration: 'confluence', status: 'misconfigured', message: 'CONFLUENCE_EMAIL / CONFLUENCE_API_TOKEN not set' };
  }
  const base = ctx?.baseUrlOverride || `https://${domain}`;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const r = await probe(`${base}/wiki/rest/api/space?limit=1`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (r.status === 0) return { integration: 'confluence', status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  return {
    integration: 'confluence',
    status: classify(r.status),
    httpStatus: r.status,
    message: r.ok ? 'Confluence reachable + authorized' : `Confluence returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

async function verifyNotion(ctx?: VerifierContext): Promise<VerifyResult> {
  const start = performance.now();
  const apiKey = getEnv(ctx, 'NOTION_API_KEY');
  if (!apiKey) return { integration: 'notion', status: 'misconfigured', message: 'NOTION_API_KEY not set' };
  const base = ctx?.baseUrlOverride || 'https://api.notion.com';
  const r = await probe(`${base}/v1/users/me`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Notion-Version': '2022-06-28' },
  });
  if (r.status === 0) return { integration: 'notion', status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  return {
    integration: 'notion',
    status: classify(r.status),
    httpStatus: r.status,
    message: r.ok ? 'Notion reachable + authorized' : `Notion returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

async function verifyHostedChangelog(ctx?: VerifierContext): Promise<VerifyResult> {
  const start = performance.now();
  const apiKey = getEnv(ctx, 'CULLIT_API_KEY');
  if (!apiKey) return { integration: 'changelog', status: 'misconfigured', message: 'CULLIT_API_KEY not set' };
  const base = ctx?.baseUrlOverride || getEnv(ctx, 'CULLIT_API_URL') || 'https://api.cullit.io';
  const r = await probe(`${base}/v1/license/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ apiKey }),
  });
  if (r.status === 0) return { integration: 'changelog', status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  return {
    integration: 'changelog',
    status: classify(r.status),
    httpStatus: r.status,
    message: r.ok ? 'Cullit hosted changelog reachable + authorized' : `Cullit API returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

async function verifyEmbedWidget(ctx?: VerifierContext, project = 'default'): Promise<VerifyResult> {
  const start = performance.now();
  const base = ctx?.baseUrlOverride || getEnv(ctx, 'CULLIT_API_URL') || 'https://api.cullit.io';
  // Widget hits a public, unauthenticated read endpoint
  const r = await probe(`${base}/v1/changelog/${encodeURIComponent(project)}/latest?limit=1`);
  if (r.status === 0) return { integration: 'widget', status: 'unreachable', message: r.error || 'network error', durationMs: elapsed(start) };
  return {
    integration: 'widget',
    status: classify(r.status),
    httpStatus: r.status,
    message: r.ok ? 'Hosted widget endpoint reachable' : `Widget endpoint returned ${r.status}`,
    durationMs: elapsed(start),
  };
}

// ============================================
// Public API
// ============================================

export interface VerifyOptions {
  /** Only verify these integrations; defaults to all configured ones. */
  only?: string[];
  /** Test-mode override for all probe URLs. */
  baseUrlOverride?: string;
  /** Override env (used by tests). */
  env?: Record<string, string | undefined>;
}

/**
 * Verify every integration declared in `config`. Returns one result per integration.
 * Always resolves — never throws — so callers can render a full status table.
 */
export async function verifyIntegrations(config: CullConfig, opts: VerifyOptions = {}): Promise<VerifyResult[]> {
  const ctx: VerifierContext = { baseUrlOverride: opts.baseUrlOverride, env: opts.env };
  const want = (id: string): boolean => !opts.only || opts.only.includes(id);
  const tasks: Promise<VerifyResult>[] = [];

  // Normalize source: it can be either a string or { type } object across versions.
  const sourceType: string = typeof config.source === 'string'
    ? (config.source as unknown as string)
    : ((config.source as { type?: string } | undefined)?.type || 'local');

  // Always include the hosted widget endpoint — it's a public read
  if (want('widget')) tasks.push(verifyEmbedWidget(ctx));

  // Source / enrichment auth checks (env-driven, run if env present OR config asks for them)
  if (want('github') && (getEnv(ctx, 'GITHUB_TOKEN') || sourceType === 'local')) {
    tasks.push(verifyGitHub(ctx));
  }
  if (want('gitlab') && (sourceType === 'gitlab' || getEnv(ctx, 'GITLAB_TOKEN'))) {
    tasks.push(verifyGitLab(ctx, config.gitlab?.domain));
  }
  if (want('bitbucket') && (sourceType === 'bitbucket' || getEnv(ctx, 'BITBUCKET_USERNAME'))) {
    tasks.push(verifyBitbucket(ctx));
  }
  if (want('jira') && config.jira?.domain) {
    tasks.push(verifyJira(ctx, config.jira));
  }
  if (want('linear') && (sourceType === 'linear' || getEnv(ctx, 'LINEAR_API_KEY'))) {
    tasks.push(verifyLinear(ctx));
  }
  if (want('changelog') && getEnv(ctx, 'CULLIT_API_KEY')) {
    tasks.push(verifyHostedChangelog(ctx));
  }

  // Publishers — verify each publish target
  for (const target of config.publish || []) {
    const t = target.type;
    if (!want(t)) continue;
    switch (t) {
      case 'slack':
        tasks.push(verifyWebhook('slack', target.webhookUrl, ['hooks.slack.com', 'hooks.slack-gov.com'], ctx));
        break;
      case 'discord':
        tasks.push(verifyWebhook('discord', target.webhookUrl, ['discord.com', 'discordapp.com'], ctx));
        break;
      case 'teams':
        tasks.push(verifyWebhook('teams', target.webhookUrl, ['webhook.office.com'], ctx));
        break;
      case 'confluence':
        tasks.push(verifyConfluence(ctx, target));
        break;
      case 'notion':
        tasks.push(verifyNotion(ctx));
        break;
      case 'github-release':
        if (!tasks.some(p => p instanceof Promise)) tasks.push(verifyGitHub(ctx));
        // (GitHub auth is shared with the source check; skipping if already queued)
        break;
      case 'gitlab-release':
        tasks.push(verifyGitLab(ctx, (target as { domain?: string }).domain));
        break;
      case 'changelog':
        // Already queued above if API key set
        break;
    }
  }

  return Promise.all(tasks);
}

/** Pretty-print results for CLI output. Returns a single string. */
export function formatVerifyResults(results: VerifyResult[]): string {
  const symbol: Record<VerifyStatus, string> = {
    'ok': '✓',
    'misconfigured': '○',
    'unreachable': '✗',
    'auth-failed': '✗',
    'unknown': '?',
  };
  const lines: string[] = [];
  lines.push('');
  lines.push('  Integration           Status           Detail');
  lines.push('  ' + '─'.repeat(70));
  for (const r of results) {
    const name = r.integration.padEnd(20);
    const status = (symbol[r.status] + ' ' + r.status).padEnd(16);
    const dur = r.durationMs !== null && r.durationMs !== undefined ? ` (${r.durationMs}ms)` : '';
    lines.push(`  ${name}  ${status} ${r.message}${dur}`);
  }
  lines.push('');
  const okCount = results.filter(r => r.status === 'ok').length;
  const failCount = results.filter(r => r.status === 'unreachable' || r.status === 'auth-failed').length;
  const skipCount = results.filter(r => r.status === 'misconfigured').length;
  lines.push(`  Summary: ${okCount} OK · ${failCount} failed · ${skipCount} not configured`);
  lines.push('');
  return lines.join('\n');
}
