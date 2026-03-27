/**
 * Shared fetch wrapper with timeout support.
 * Prevents hanging on unresponsive external APIs.
 */

import { CullitError, CoreErrorCode } from './errors';

const DEFAULT_TIMEOUT = 30_000; // 30 seconds

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new CullitError(CoreErrorCode.FETCH_TIMEOUT, `Request to ${new URL(url).hostname} timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
