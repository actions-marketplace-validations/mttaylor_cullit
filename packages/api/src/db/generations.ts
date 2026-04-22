/** Generation history + daily usage analytics DB operations. */

import { sql } from './client.js';

export async function dbAddGeneration(entry: {
  id: string; userId: string; project: string; from: string; to: string;
  provider: string; format: string; changeCount: number; summary: string; duration: number;
}): Promise<void> {
  await sql`
    INSERT INTO generations (id, user_id, project, from_ref, to_ref, provider, format, change_count, summary, duration)
    VALUES (${entry.id}, ${entry.userId}, ${entry.project}, ${entry.from}, ${entry.to},
            ${entry.provider}, ${entry.format}, ${entry.changeCount}, ${entry.summary}, ${entry.duration})
  `;
}

export async function dbGetGenerations(userId: string, limit: number, offset: number, cursor?: string): Promise<{
  id: string; user_id: string; project: string; from_ref: string; to_ref: string;
  provider: string; format: string; change_count: number; summary: string; duration: number; created_at: Date;
}[]> {
  if (cursor) {
    return sql`
      SELECT * FROM generations
      WHERE user_id = ${userId}
        AND (created_at, id) < (SELECT created_at, id FROM generations WHERE id = ${cursor})
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `;
  }
  return sql`
    SELECT * FROM generations
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function dbGetGenerationCount(userId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`SELECT COUNT(*)::text AS count FROM generations WHERE user_id = ${userId}`;
  return parseInt(rows[0].count, 10);
}

export async function dbGetMonthlyGenerationCount(key: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`
    SELECT COALESCE(SUM(generations), 0)::text AS count
    FROM usage_daily
    WHERE key = ${key}
      AND date >= DATE_TRUNC('month', CURRENT_DATE)
  `;
  return parseInt(rows[0].count, 10);
}

// --- Usage analytics DB operations ---

export async function dbRecordUsage(event: {
  key: string; provider: string; changeCount: number; duration: number;
}): Promise<void> {
  await sql`
    INSERT INTO usage_daily (key, date, generations, total_changes, avg_duration, providers)
    VALUES (${event.key}, CURRENT_DATE, 1, ${event.changeCount}, ${event.duration},
            ${JSON.stringify({ [event.provider]: 1 })}::jsonb)
    ON CONFLICT (key, date) DO UPDATE SET
      generations = usage_daily.generations + 1,
      total_changes = usage_daily.total_changes + EXCLUDED.total_changes,
      avg_duration = ((usage_daily.avg_duration * usage_daily.generations) + EXCLUDED.avg_duration)
                     / (usage_daily.generations + 1),
      providers = (
        SELECT jsonb_object_agg(k, COALESCE((usage_daily.providers->>k)::int, 0) + COALESCE((EXCLUDED.providers->>k)::int, 0))
        FROM jsonb_each_text(usage_daily.providers || EXCLUDED.providers) AS x(k, v)
      )
  `;
}

export async function dbGetUsageStats(key: string, days: number): Promise<{
  daily: { date: string; generations: number; total_changes: number; avg_duration: number; providers: Record<string, number> }[];
  totals: { generations: number; totalChanges: number; avgDuration: number };
  topProviders: { provider: string; count: number }[];
}> {
  interface UsageDailyRow {
    date: string;
    generations: number;
    total_changes: number;
    avg_duration: number;
    providers: string | Record<string, number>;
  }

  const rows = await sql<UsageDailyRow[]>`
    SELECT date::text, generations, total_changes, avg_duration, providers
    FROM usage_daily
    WHERE key = ${key} AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date DESC
  `;

  let totalGens = 0, totalChanges = 0, totalDuration = 0;
  const providerMap: Record<string, number> = {};
  const daily = rows.map(r => {
    totalGens += r.generations;
    totalChanges += r.total_changes;
    totalDuration += r.avg_duration * r.generations;
    const providers = typeof r.providers === 'string' ? JSON.parse(r.providers) : r.providers;
    for (const [p, c] of Object.entries(providers)) {
      providerMap[p] = (providerMap[p] || 0) + (c as number);
    }
    return {
      date: r.date,
      generations: r.generations,
      total_changes: r.total_changes,
      avg_duration: r.avg_duration,
      providers,
    };
  });

  const topProviders = Object.entries(providerMap)
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count);

  return {
    daily,
    totals: {
      generations: totalGens,
      totalChanges,
      avgDuration: totalGens > 0 ? Math.round(totalDuration / totalGens) : 0,
    },
    topProviders,
  };
}
