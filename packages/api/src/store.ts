/**
 * Cullit Data Store — Generation History & Analytics
 *
 * File-backed JSON persistence (same pattern as changelog store).
 * Stores per-user generation history and aggregated usage metrics.
 *
 * Path: CULLIT_HISTORY_STORE_PATH (default: ./history-store.json)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  sql, dbAddGeneration, dbGetGenerations, dbGetGenerationCount,
  dbRecordUsage, dbGetUsageStats, dbGetMonthlyGenerationCount,
} from './db.js';
import { useDb } from './auth.js';

// --- Config ---

const HISTORY_FILE = process.env['CULLIT_HISTORY_STORE_PATH'] || './history-store.json';
const MAX_HISTORY_PER_USER = 200;
const MAX_USERS_WITH_HISTORY = 5000;

// --- Types ---

export interface HistoryEntry {
  id: string;
  userId: string;
  project: string;
  from: string;
  to: string;
  provider: string;
  format: string;
  changeCount: number;
  summary: string;       // first 500 chars of formatted output
  duration: number;       // ms
  createdAt: string;
}

export interface UsageEvent {
  userId: string;
  orgId: string | null;
  project: string;
  provider: string;
  changeCount: number;
  duration: number;
  timestamp: string;
}

export interface DailyUsage {
  date: string;           // YYYY-MM-DD
  generations: number;
  totalChanges: number;
  avgDuration: number;
  providers: Record<string, number>;
}

interface HistoryStore {
  history: Record<string, HistoryEntry[]>;  // userId → entries
  dailyUsage: Record<string, DailyUsage[]>; // orgId|userId → daily stats
}

// --- Store ---

const store: HistoryStore = { history: {}, dailyUsage: {} };

export function loadHistoryStore(): void {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
      if (data.history) store.history = data.history;
      if (data.dailyUsage) store.dailyUsage = data.dailyUsage;
      const userCount = Object.keys(store.history).length;
      console.log(`Loaded history store: ${userCount} users with history`);
    }
  } catch (err) {
    console.warn('Failed to load history store:', (err as Error).message);
  }
}

function saveHistoryStore(): void {
  try {
    writeFileSync(HISTORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save history store:', (err as Error).message);
  }
}

loadHistoryStore();

// --- History ---

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  if (useDb) {
    await dbAddGeneration({
      id: entry.id, userId: entry.userId, project: entry.project,
      from: entry.from, to: entry.to, provider: entry.provider,
      format: entry.format, changeCount: entry.changeCount,
      summary: entry.summary, duration: entry.duration,
    });
    return;
  }

  const entries = store.history[entry.userId] || [];

  // Cap per-user history
  entries.unshift(entry);
  if (entries.length > MAX_HISTORY_PER_USER) {
    entries.length = MAX_HISTORY_PER_USER;
  }

  // Cap total users with history
  if (!store.history[entry.userId] && Object.keys(store.history).length >= MAX_USERS_WITH_HISTORY) {
    return; // silently skip
  }

  store.history[entry.userId] = entries;
  saveHistoryStore();
}

export async function getHistory(userId: string, limit: number = 20, offset: number = 0): Promise<HistoryEntry[]> {
  if (useDb) {
    const rows = await dbGetGenerations(userId, limit, offset);
    return rows.map(r => ({
      id: r.id, userId: r.user_id, project: r.project,
      from: r.from_ref, to: r.to_ref, provider: r.provider,
      format: r.format, changeCount: r.change_count,
      summary: r.summary, duration: r.duration,
      createdAt: r.created_at.toISOString(),
    }));
  }
  const entries = store.history[userId] || [];
  return entries.slice(offset, offset + limit);
}

export async function getHistoryCount(userId: string): Promise<number> {
  if (useDb) return dbGetGenerationCount(userId);
  return (store.history[userId] || []).length;
}

// --- Analytics ---

export async function recordUsageEvent(event: UsageEvent): Promise<void> {
  if (useDb) {
    await dbRecordUsage({
      key: event.orgId || event.userId,
      provider: event.provider,
      changeCount: event.changeCount,
      duration: event.duration,
    });
    return;
  }

  const key = event.orgId || event.userId;
  const date = event.timestamp.split('T')[0]; // YYYY-MM-DD

  const dailyEntries = store.dailyUsage[key] || [];
  let today = dailyEntries.find(d => d.date === date);

  if (!today) {
    today = { date, generations: 0, totalChanges: 0, avgDuration: 0, providers: {} };
    dailyEntries.unshift(today);

    // Keep 90 days of daily stats
    if (dailyEntries.length > 90) {
      dailyEntries.length = 90;
    }
  }

  // Update aggregates
  const prevTotal = today.avgDuration * today.generations;
  today.generations++;
  today.totalChanges += event.changeCount;
  today.avgDuration = Math.round((prevTotal + event.duration) / today.generations);
  today.providers[event.provider] = (today.providers[event.provider] || 0) + 1;

  store.dailyUsage[key] = dailyEntries;
  saveHistoryStore();
}

export async function getUsageStats(key: string, days: number = 30): Promise<{
  daily: DailyUsage[];
  totals: { generations: number; totalChanges: number; avgDuration: number };
  topProviders: { provider: string; count: number }[];
}> {
  if (useDb) {
    const stats = await dbGetUsageStats(key, days);
    return {
      daily: stats.daily.map(d => ({
        date: d.date,
        generations: d.generations,
        totalChanges: d.total_changes,
        avgDuration: d.avg_duration,
        providers: d.providers,
      })),
      totals: stats.totals,
      topProviders: stats.topProviders,
    };
  }

  const entries = store.dailyUsage[key] || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const filtered = entries.filter(d => d.date >= cutoffStr);

  // Compute totals
  let totalGens = 0, totalChanges = 0, totalDuration = 0;
  const providerMap: Record<string, number> = {};

  for (const d of filtered) {
    totalGens += d.generations;
    totalChanges += d.totalChanges;
    totalDuration += d.avgDuration * d.generations;
    for (const [p, c] of Object.entries(d.providers)) {
      providerMap[p] = (providerMap[p] || 0) + c;
    }
  }

  const topProviders = Object.entries(providerMap)
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count);

  return {
    daily: filtered,
    totals: {
      generations: totalGens,
      totalChanges,
      avgDuration: totalGens > 0 ? Math.round(totalDuration / totalGens) : 0,
    },
    topProviders,
  };
}

/**
 * Get this month's generation count for a user/org.
 */
export async function getMonthlyGenerationCount(key: string): Promise<number> {
  if (useDb) return dbGetMonthlyGenerationCount(key);

  const entries = store.dailyUsage[key] || [];
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return entries
    .filter(d => d.date.startsWith(monthPrefix))
    .reduce((sum, d) => sum + d.generations, 0);
}
