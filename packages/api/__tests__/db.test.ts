import { describe, it, expect } from 'vitest';
import { migrate, closeDb, sql } from '../src/db.js';
import type { DbUser, DbOrg } from '../src/db.js';

describe('Database Module', () => {
  it('sql is null when DATABASE_URL is not set', () => {
    expect(sql).toBeNull();
  });

  it('migrate is a no-op when DATABASE_URL is not set', async () => {
    // Should not throw
    await migrate();
  });

  it('closeDb is a no-op when DATABASE_URL is not set', async () => {
    // Should not throw
    await closeDb();
  });

  it('exports all expected DB functions', async () => {
    const db = await import('../src/db.js');
    const expectedExports = [
      'sql', 'migrate', 'closeDb',
      'dbGetUser', 'dbGetUserByApiKey', 'dbGetUserByStripeCustomer',
      'dbUpsertUser', 'dbUpdateUserTier', 'dbUpdateUserOrg', 'dbUpdateUserStripe', 'dbUpdateUserTrial', 'dbClearUserTrial',
      'dbGetOrg', 'dbGetOrgBySlug', 'dbCreateOrg',
      'dbGetOrgMemberCount', 'dbAddOrgMember', 'dbRemoveOrgMember', 'dbGetOrgMembers',
      'dbAddGeneration', 'dbGetGenerations', 'dbGetGenerationCount', 'dbGetMonthlyGenerationCount',
      'dbRecordUsage', 'dbGetUsageStats',
      'dbPublishRelease', 'dbGetReleases', 'dbGetProjectCount',
      'dbUpsertSubscription', 'dbGetSubscription',
    ];
    for (const name of expectedExports) {
      expect(db).toHaveProperty(name);
    }
  });
});
