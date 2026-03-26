import pino from 'pino';
import type { CorsResponse } from './utils.js';

export const log = pino({
  level: process.env['LOG_LEVEL'] || 'info',
  name: 'cullit-api',
});

/** Create a child logger with the request ID bound for per-request tracing. */
export function requestLog(res: CorsResponse): pino.Logger {
  return res._requestId ? log.child({ requestId: res._requestId }) : log;
}