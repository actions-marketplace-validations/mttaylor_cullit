/**
 * Shared utilities for the Cullit API.
 *
 * Centralizes helper functions and types used across multiple modules
 * to eliminate duplication (e.g. isRecord was duplicated in index.ts and billing.ts).
 */

import { timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import createSanitizer from 'sanitize-html';

// --- Types ---

/** ServerResponse with per-request CORS origin attached. */
export interface CorsResponse extends ServerResponse { _corsOrigin?: string; }

export type JsonObject = Record<string, unknown>;

// --- Config (read once at module load) ---

export const PORT = parseInt(process.env['PORT'] || '3000', 10);

const IS_HTTPS = (process.env['CULLIT_BASE_URL'] || '').startsWith('https');
const API_TOKEN = process.env['CULLIT_API_TOKEN'] || '';

// --- Security headers ---

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  ...(IS_HTTPS ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
};

// --- Response helper ---

export function json(res: CorsResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': res._corsOrigin || '',
    'Access-Control-Allow-Credentials': 'true',
    ...SECURITY_HEADERS,
  });
  res.end(payload);
}

// --- Auth helper ---

export function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!API_TOKEN) return true; // no auth configured
  const header = req.headers['authorization'] || '';
  const expected = `Bearer ${API_TOKEN}`;
  if (header.length === expected.length &&
      timingSafeEqual(Buffer.from(header), Buffer.from(expected))) return true;
  json(res, 401, { error: 'Unauthorized — set Authorization: Bearer <token>' });
  return false;
}

// --- Request body reader ---

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  const MAX_BODY = 1_048_576; // 1 MB

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// --- Utility functions ---

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

export function parseJsonObject(raw: string): JsonObject | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function toStringArray(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, limit).filter((v): v is string => typeof v === 'string');
}

/** Strip dangerous HTML tags and attributes to prevent stored XSS. */
export function sanitizeHtml(html: string): string {
  return createSanitizer(html, {
    allowedTags: createSanitizer.defaults.allowedTags.concat(['h1', 'h2', 'img', 'details', 'summary']),
    allowedAttributes: {
      ...createSanitizer.defaults.allowedAttributes,
      img: ['src', 'alt', 'title', 'width', 'height'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
  });
}
