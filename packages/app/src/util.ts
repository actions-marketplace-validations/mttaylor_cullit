/**
 * Small utilities shared across the GitHub App modules.
 */

/** Decode the GitHub App private key, supporting both base64 and raw PEM. */
export function decodeKey(key: string): string {
  if (!key) return '';
  // If it looks like a PEM, use as-is. Otherwise decode base64.
  if (key.includes('BEGIN')) return key.replace(/\\n/g, '\n');
  try { return Buffer.from(key, 'base64').toString('utf-8'); }
  catch { return key; }
}

export function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
