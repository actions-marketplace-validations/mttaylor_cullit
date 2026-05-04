/**
 * History + Analytics routes.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import { resolveUser } from '../auth.js';
import {
  getHistory, getHistoryCount, getUsageStats, getMonthlyGenerationCount,
} from '../store.js';
import { json, PORT } from '../utils.js';

export async function handleGetHistory(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));

  const cursor = url.searchParams.get('cursor') || undefined;
  const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = cursor ? 0 : Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  const entries = await getHistory(user.id, limit + 1, offset, cursor);
  const hasMore = entries.length > limit;
  const page = hasMore ? entries.slice(0, limit) : entries;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : undefined;
  const total = await getHistoryCount(user.id);

  json(res, 200, { entries: page, total, limit, offset, cursor: nextCursor, hasMore });
}

export async function handleGetAnalytics(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await resolveUser(req);
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return; }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const rawDays = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Math.max(1, Math.min(isNaN(rawDays) ? 30 : rawDays, 90));

  const key = user.orgId || user.id;
  const stats = await getUsageStats(key, days);
  const monthlyCount = await getMonthlyGenerationCount(key);

  json(res, 200, {
    ...stats,
    monthlyGenerations: monthlyCount,
    tier: user.tier,
    teamAnalytics: true,
  });
}
