import { describe, it, expect } from 'vitest';
import {
  addHistoryEntry,
  getHistory,
  getHistoryCount,
  recordUsageEvent,
  getUsageStats,
  getMonthlyGenerationCount,
  type HistoryEntry,
  type UsageEvent,
} from '../src/store.js';

// Note: These tests operate on the in-memory store.
// The store module loads from disk on import but we test the logic, not persistence.

function makeEntry(userId: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'test-' + Math.random().toString(36).slice(2, 10),
    userId,
    project: 'test-project',
    from: 'v1.0.0',
    to: 'v1.1.0',
    provider: 'anthropic',
    format: 'markdown',
    changeCount: 5,
    summary: 'Test summary',
    duration: 1200,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(userId: string, overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    userId,
    orgId: null,
    project: 'test-project',
    provider: 'anthropic',
    changeCount: 5,
    duration: 1200,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('Store Module — History', () => {
  const testUser = 'store-test-user-' + Date.now();

  it('getHistory returns empty array for unknown user', async () => {
    const entries = await getHistory('nonexistent-user-xyz');
    expect(entries).toEqual([]);
  });

  it('getHistoryCount returns 0 for unknown user', async () => {
    expect(await getHistoryCount('nonexistent-user-xyz')).toBe(0);
  });

  it('addHistoryEntry adds and retrieves entries', async () => {
    const entry = makeEntry(testUser);
    await addHistoryEntry(entry);

    const entries = await getHistory(testUser);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].id).toBe(entry.id);
    expect(entries[0].userId).toBe(testUser);
  });

  it('getHistoryCount reflects added entries', async () => {
    const before = await getHistoryCount(testUser);
    await addHistoryEntry(makeEntry(testUser));
    expect(await getHistoryCount(testUser)).toBe(before + 1);
  });

  it('getHistory supports limit and offset', async () => {
    const user = 'paginate-user-' + Date.now();
    for (let i = 0; i < 5; i++) {
      await addHistoryEntry(makeEntry(user, { id: `page-${i}` }));
    }

    const page1 = await getHistory(user, 2, 0);
    expect(page1).toHaveLength(2);

    const page2 = await getHistory(user, 2, 2);
    expect(page2).toHaveLength(2);

    const page3 = await getHistory(user, 2, 4);
    expect(page3).toHaveLength(1);
  });

  it('newest entries appear first', async () => {
    const user = 'order-user-' + Date.now();
    await addHistoryEntry(makeEntry(user, { id: 'first' }));
    await addHistoryEntry(makeEntry(user, { id: 'second' }));

    const entries = await getHistory(user, 10, 0);
    expect(entries[0].id).toBe('second');
    expect(entries[1].id).toBe('first');
  });
});

describe('Store Module — Analytics', () => {
  const testKey = 'analytics-test-' + Date.now();

  it('getUsageStats returns empty defaults for unknown key', async () => {
    const stats = await getUsageStats('nonexistent-analytics-xyz');
    expect(stats.daily).toEqual([]);
    expect(stats.totals.generations).toBe(0);
    expect(stats.topProviders).toEqual([]);
  });

  it('recordUsageEvent aggregates into daily stats', async () => {
    await recordUsageEvent(makeEvent(testKey, { orgId: null }));

    const stats = await getUsageStats(testKey, 30);
    expect(stats.totals.generations).toBeGreaterThanOrEqual(1);
    expect(stats.daily.length).toBeGreaterThanOrEqual(1);
  });

  it('records provider breakdown', async () => {
    const key = 'provider-test-' + Date.now();
    await recordUsageEvent(makeEvent(key, { provider: 'openai' }));
    await recordUsageEvent(makeEvent(key, { provider: 'openai' }));
    await recordUsageEvent(makeEvent(key, { provider: 'anthropic' }));

    const stats = await getUsageStats(key, 30);
    const openai = stats.topProviders.find(p => p.provider === 'openai');
    const anthropic = stats.topProviders.find(p => p.provider === 'anthropic');
    expect(openai?.count).toBe(2);
    expect(anthropic?.count).toBe(1);
  });

  it('getMonthlyGenerationCount returns count for current month', async () => {
    const key = 'monthly-test-' + Date.now();
    await recordUsageEvent(makeEvent(key));
    await recordUsageEvent(makeEvent(key));

    const count = await getMonthlyGenerationCount(key);
    expect(count).toBe(2);
  });

  it('topProviders are sorted by count descending', async () => {
    const key = 'sort-test-' + Date.now();
    await recordUsageEvent(makeEvent(key, { provider: 'gemini' }));
    await recordUsageEvent(makeEvent(key, { provider: 'anthropic' }));
    await recordUsageEvent(makeEvent(key, { provider: 'anthropic' }));
    await recordUsageEvent(makeEvent(key, { provider: 'anthropic' }));

    const stats = await getUsageStats(key, 30);
    expect(stats.topProviders[0].provider).toBe('anthropic');
    expect(stats.topProviders[0].count).toBe(3);
  });
});
