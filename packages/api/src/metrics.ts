/**
 * Lightweight in-process metrics for Cullit API.
 *
 * Aggregates counters and gauges in memory. Exposed via GET /metrics
 * in Prometheus text exposition format for easy scraping.
 *
 * LIMITATION: All counters are in-memory and reset on process restart.
 * This is by design — Prometheus scrapes regularly and maintains its own
 * time-series DB, so ephemeral counters are expected. However, if you need
 * metrics to survive restarts without Prometheus, consider persisting
 * counter snapshots to the database.
 *
 * Tracked metrics:
 *   cullit_generations_total        — successful generations (by provider)
 *   cullit_generation_errors_total  — failed generations
 *   cullit_ai_tokens_total          — approximate AI tokens consumed
 *   cullit_publish_total            — changelogs published (by type)
 *   cullit_auth_logins_total        — GitHub OAuth logins
 *   cullit_http_requests_total      — requests by method + status
 *   cullit_rate_limited_total       — requests that hit rate limit
 */

import type { IncomingMessage, ServerResponse } from 'http';

// --- Counter storage ---

const counters = new Map<string, number>();

function inc(name: string, labels: Record<string, string> = {}, amount = 1): void {
  const key = formatKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + amount);
}

function formatKey(name: string, labels: Record<string, string>): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return parts ? `${name}{${parts}}` : name;
}

// --- Public API ---

export const metrics = {
  /** Record a successful generation */
  generation(provider: string): void {
    inc('cullit_generations_total', { provider });
  },

  /** Record a generation failure */
  generationError(): void {
    inc('cullit_generation_errors_total');
  },

  /** Record approximate AI token usage */
  aiTokens(provider: string, count: number): void {
    inc('cullit_ai_tokens_total', { provider }, count);
  },

  /** Record a changelog publish */
  publish(target: string): void {
    inc('cullit_publish_total', { target });
  },

  /** Record a login */
  login(): void {
    inc('cullit_auth_logins_total');
  },

  /** Record an HTTP request */
  httpRequest(method: string, status: number): void {
    inc('cullit_http_requests_total', { method, status: String(status) });
  },

  /** Record a rate-limited request */
  rateLimited(): void {
    inc('cullit_rate_limited_total');
  },
};

// --- Prometheus text format ---

export function handleMetrics(req: IncomingMessage, res: ServerResponse): void {
  // Gate behind METRICS_TOKEN if set (production security)
  const token = process.env['METRICS_TOKEN'];
  if (token) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${token}`) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden\n');
      return;
    }
  }

  const lines: string[] = [
    '# HELP cullit_generations_total Total successful generations',
    '# TYPE cullit_generations_total counter',
    '# HELP cullit_generation_errors_total Total failed generations',
    '# TYPE cullit_generation_errors_total counter',
    '# HELP cullit_ai_tokens_total Approximate AI tokens consumed',
    '# TYPE cullit_ai_tokens_total counter',
    '# HELP cullit_publish_total Changelogs published',
    '# TYPE cullit_publish_total counter',
    '# HELP cullit_auth_logins_total GitHub OAuth logins',
    '# TYPE cullit_auth_logins_total counter',
    '# HELP cullit_http_requests_total HTTP requests by method and status',
    '# TYPE cullit_http_requests_total counter',
    '# HELP cullit_rate_limited_total Rate limited requests',
    '# TYPE cullit_rate_limited_total counter',
  ];

  for (const [key, value] of counters) {
    lines.push(`${key} ${value}`);
  }

  const body = lines.join('\n') + '\n';
  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
