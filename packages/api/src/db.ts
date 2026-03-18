/**
 * Cullit Database Layer
 *
 * PostgreSQL persistence via porsager/postgres (zero-dep client).
 * Replaces file-backed JSON stores for production scalability.
 *
 * Tables:
 *   users           — GitHub OAuth users + API keys
 *   orgs            — Organizations / teams
 *   org_members     — Org membership (join table)
 *   generations     — Per-user generation history
 *   usage_daily     — Aggregated daily analytics
 *   changelog_releases — Published changelog entries
 *   subscriptions   — Stripe billing state
 *
 * Environment:
 *   DATABASE_URL — PostgreSQL connection string (required for DB mode)
 *
 * Falls back to file-backed JSON if DATABASE_URL is not set,
 * allowing local dev without Postgres.
 */

import postgres from 'postgres';
import { log } from './logger.js';

const DATABASE_URL = process.env['DATABASE_URL'] || '';

if (!DATABASE_URL) {
  log.warn('DATABASE_URL is not set — database features are disabled.');
}

export const sql = DATABASE_URL
  ? postgres(DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      types: { bigint: postgres.BigInt },
    })
  : (null as unknown as ReturnType<typeof postgres>);

/**
 * Run database migrations — creates tables if they don't exist.
 * Safe to call on every startup (idempotent).
 */
export async function migrate(): Promise<void> {
  if (!sql) return;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      login         TEXT NOT NULL,
      name          TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL DEFAULT '',
      avatar_url    TEXT NOT NULL DEFAULT '',
      tier          TEXT NOT NULL DEFAULT 'free',
      org_id        TEXT,
      role          TEXT NOT NULL DEFAULT 'member',
      api_key       TEXT UNIQUE NOT NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      trial_tier    TEXT,
      trial_starts_at TIMESTAMPTZ,
      trial_ends_at TIMESTAMPTZ,
      trial_converted_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_tier TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_starts_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_converted_at TIMESTAMPTZ`;

  await sql`CREATE INDEX IF NOT EXISTS idx_users_api_key ON users (api_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS orgs (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      slug       TEXT UNIQUE NOT NULL,
      owner_id   TEXT NOT NULL REFERENCES users(id),
      tier       TEXT NOT NULL DEFAULT 'team',
      max_seats  INT NOT NULL DEFAULT 10,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS org_members (
      org_id    TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role      TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS generations (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      project      TEXT NOT NULL,
      from_ref     TEXT NOT NULL,
      to_ref       TEXT NOT NULL,
      provider     TEXT NOT NULL,
      format       TEXT NOT NULL,
      change_count INT NOT NULL DEFAULT 0,
      summary      TEXT NOT NULL DEFAULT '',
      duration     INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_generations_user ON generations (user_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS usage_daily (
      key           TEXT NOT NULL,
      date          DATE NOT NULL,
      generations   INT NOT NULL DEFAULT 0,
      total_changes INT NOT NULL DEFAULT 0,
      avg_duration  INT NOT NULL DEFAULT 0,
      providers     JSONB NOT NULL DEFAULT '{}',
      PRIMARY KEY (key, date)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS changelog_releases (
      project      TEXT NOT NULL,
      version      TEXT NOT NULL,
      date         DATE NOT NULL DEFAULT CURRENT_DATE,
      summary      TEXT NOT NULL DEFAULT '',
      changes      JSONB NOT NULL DEFAULT '[]',
      contributors JSONB NOT NULL DEFAULT '[]',
      metadata     JSONB,
      formatted_md TEXT NOT NULL DEFAULT '',
      formatted_html TEXT NOT NULL DEFAULT '',
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project, version)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_changelog_project ON changelog_releases (project, published_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                      TEXT PRIMARY KEY,
      user_id                 TEXT NOT NULL REFERENCES users(id),
      stripe_subscription_id  TEXT UNIQUE NOT NULL,
      stripe_customer_id      TEXT NOT NULL,
      plan                    TEXT NOT NULL DEFAULT 'free',
      status                  TEXT NOT NULL DEFAULT 'active',
      current_period_start    TIMESTAMPTZ,
      current_period_end      TIMESTAMPTZ,
      cancel_at_period_end    BOOLEAN NOT NULL DEFAULT false,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions (stripe_subscription_id)`;

  log.info('Database migrations complete');
}

// --- User DB operations ---

export interface DbUser {
  id: string;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
  tier: string;
  org_id: string | null;
  role: string;
  api_key: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_tier: string | null;
  trial_starts_at: Date | null;
  trial_ends_at: Date | null;
  trial_converted_at: Date | null;
  created_at: Date;
  last_login_at: Date;
}

export async function dbGetUser(id: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] || null;
}

export async function dbGetUserByApiKey(apiKey: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE api_key = ${apiKey}`;
  return rows[0] || null;
}

export async function dbGetUserByStripeCustomer(customerId: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE stripe_customer_id = ${customerId}`;
  return rows[0] || null;
}

export async function dbUpsertUser(user: {
  id: string; login: string; name: string; email: string;
  avatarUrl: string; apiKey: string;
  trialTier?: string | null;
  trialStartsAt?: Date | null;
  trialEndsAt?: Date | null;
}): Promise<DbUser> {
  const rows = await sql<DbUser[]>`
    INSERT INTO users (id, login, name, email, avatar_url, api_key, trial_tier, trial_starts_at, trial_ends_at)
    VALUES (${user.id}, ${user.login}, ${user.name}, ${user.email}, ${user.avatarUrl}, ${user.apiKey}, ${user.trialTier || null}, ${user.trialStartsAt || null}, ${user.trialEndsAt || null})
    ON CONFLICT (id) DO UPDATE SET
      login = EXCLUDED.login,
      name = EXCLUDED.name,
      email = CASE WHEN EXCLUDED.email != '' THEN EXCLUDED.email ELSE users.email END,
      avatar_url = EXCLUDED.avatar_url,
      last_login_at = NOW()
    RETURNING *
  `;
  return rows[0];
}

export async function dbUpdateUserTier(userId: string, tier: string): Promise<void> {
  await sql`UPDATE users SET tier = ${tier} WHERE id = ${userId}`;
}

export async function dbUpdateUserOrg(userId: string, orgId: string | null, role: string, tier: string): Promise<void> {
  await sql`UPDATE users SET org_id = ${orgId}, role = ${role}, tier = ${tier} WHERE id = ${userId}`;
}

export async function dbUpdateUserStripe(userId: string, customerId: string, subscriptionId: string | null): Promise<void> {
  await sql`UPDATE users SET stripe_customer_id = ${customerId}, stripe_subscription_id = ${subscriptionId} WHERE id = ${userId}`;
}

export async function dbUpdateUserTrial(userId: string, trialTier: string | null, startsAt: Date | null, endsAt: Date | null): Promise<void> {
  await sql`
    UPDATE users
    SET trial_tier = ${trialTier}, trial_starts_at = ${startsAt}, trial_ends_at = ${endsAt}
    WHERE id = ${userId}
  `;
}

export async function dbClearUserTrial(userId: string): Promise<void> {
  await sql`
    UPDATE users
    SET trial_tier = NULL,
        trial_starts_at = NULL,
        trial_ends_at = NULL,
        trial_converted_at = NOW()
    WHERE id = ${userId}
  `;
}

// --- Org DB operations ---

export interface DbOrg {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  tier: string;
  max_seats: number;
  created_at: Date;
}

export async function dbGetOrg(id: string): Promise<DbOrg | null> {
  const rows = await sql<DbOrg[]>`SELECT * FROM orgs WHERE id = ${id}`;
  return rows[0] || null;
}

export async function dbGetOrgBySlug(slug: string): Promise<DbOrg | null> {
  const rows = await sql<DbOrg[]>`SELECT * FROM orgs WHERE slug = ${slug}`;
  return rows[0] || null;
}

export async function dbCreateOrg(org: { id: string; name: string; slug: string; ownerId: string; tier: string; maxSeats: number }): Promise<DbOrg> {
  const rows = await sql<DbOrg[]>`
    INSERT INTO orgs (id, name, slug, owner_id, tier, max_seats)
    VALUES (${org.id}, ${org.name}, ${org.slug}, ${org.ownerId}, ${org.tier}, ${org.maxSeats})
    RETURNING *
  `;
  return rows[0];
}

export async function dbGetOrgMemberCount(orgId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`SELECT COUNT(*)::text AS count FROM org_members WHERE org_id = ${orgId}`;
  return parseInt(rows[0].count, 10);
}

export async function dbAddOrgMember(orgId: string, userId: string, role: string): Promise<boolean> {
  try {
    await sql`INSERT INTO org_members (org_id, user_id, role) VALUES (${orgId}, ${userId}, ${role})`;
    return true;
  } catch {
    return false; // duplicate or constraint violation
  }
}

export async function dbRemoveOrgMember(orgId: string, userId: string): Promise<boolean> {
  const result = await sql`DELETE FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`;
  return result.count > 0;
}

export async function dbGetOrgMembers(orgId: string): Promise<DbUser[]> {
  return sql<DbUser[]>`
    SELECT u.* FROM users u
    JOIN org_members om ON u.id = om.user_id
    WHERE om.org_id = ${orgId}
    ORDER BY om.joined_at
  `;
}

// --- Generation history DB operations ---

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

export async function dbGetGenerations(userId: string, limit: number, offset: number): Promise<{
  id: string; user_id: string; project: string; from_ref: string; to_ref: string;
  provider: string; format: string; change_count: number; summary: string; duration: number; created_at: Date;
}[]> {
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
  const rows = await sql`
    SELECT date::text, generations, total_changes, avg_duration, providers
    FROM usage_daily
    WHERE key = ${key} AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date DESC
  `;

  let totalGens = 0, totalChanges = 0, totalDuration = 0;
  const providerMap: Record<string, number> = {};
  const daily = rows.map((r: any) => {
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

// --- Changelog DB operations ---

export async function dbPublishRelease(project: string, release: {
  version: string; date: string; summary: string;
  changes: { description: string; category: string; ticketKey?: string }[];
  contributors: string[]; metadata?: Record<string, unknown>;
  formattedMd: string; formattedHtml: string;
}): Promise<void> {
  await sql`
    INSERT INTO changelog_releases (project, version, date, summary, changes, contributors, metadata, formatted_md, formatted_html)
    VALUES (${project}, ${release.version}, ${release.date}, ${release.summary},
            ${JSON.stringify(release.changes)}::jsonb, ${JSON.stringify(release.contributors)}::jsonb,
            ${release.metadata ? JSON.stringify(release.metadata) : null}::jsonb,
            ${release.formattedMd}, ${release.formattedHtml})
    ON CONFLICT (project, version) DO UPDATE SET
      date = EXCLUDED.date,
      summary = EXCLUDED.summary,
      changes = EXCLUDED.changes,
      contributors = EXCLUDED.contributors,
      metadata = EXCLUDED.metadata,
      formatted_md = EXCLUDED.formatted_md,
      formatted_html = EXCLUDED.formatted_html,
      published_at = NOW()
  `;
}

export async function dbGetReleases(project: string, limit: number): Promise<{
  version: string; date: string; summary: string;
  changes: unknown[]; contributors: string[];
  formatted: { markdown: string; html: string };
}[]> {
  const rows = await sql`
    SELECT version, date::text, summary, changes, contributors, formatted_md, formatted_html
    FROM changelog_releases
    WHERE project = ${project}
    ORDER BY published_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r: any) => ({
    version: r.version,
    date: r.date,
    summary: r.summary,
    changes: typeof r.changes === 'string' ? JSON.parse(r.changes) : r.changes,
    contributors: typeof r.contributors === 'string' ? JSON.parse(r.contributors) : r.contributors,
    formatted: { markdown: r.formatted_md, html: r.formatted_html },
  }));
}

export async function dbGetProjectCount(): Promise<number> {
  const rows = await sql<[{ count: string }]>`SELECT COUNT(DISTINCT project)::text AS count FROM changelog_releases`;
  return parseInt(rows[0].count, 10);
}

export async function dbDeleteRelease(project: string, version: string): Promise<boolean> {
  const result = await sql`DELETE FROM changelog_releases WHERE project = ${project} AND version = ${version}`;
  return result.count > 0;
}

export async function dbGetUserProjects(userId: string): Promise<string[]> {
  const rows = await sql`SELECT DISTINCT project FROM changelog_releases ORDER BY project`;
  return rows.map((r: any) => r.project);
}

// --- Subscription DB operations ---

export async function dbUpsertSubscription(sub: {
  id: string; userId: string; stripeSubscriptionId: string; stripeCustomerId: string;
  plan: string; status: string;
  currentPeriodStart?: Date; currentPeriodEnd?: Date; cancelAtPeriodEnd?: boolean;
}): Promise<void> {
  await sql`
    INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_customer_id, plan, status,
      current_period_start, current_period_end, cancel_at_period_end)
    VALUES (${sub.id}, ${sub.userId}, ${sub.stripeSubscriptionId}, ${sub.stripeCustomerId},
            ${sub.plan}, ${sub.status},
            ${sub.currentPeriodStart || null}, ${sub.currentPeriodEnd || null}, ${sub.cancelAtPeriodEnd || false})
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = NOW()
  `;
}

export async function dbGetSubscription(userId: string): Promise<{
  id: string; plan: string; status: string;
  stripe_subscription_id: string; stripe_customer_id: string;
  current_period_start: Date | null; current_period_end: Date | null;
  cancel_at_period_end: boolean;
} | null> {
  if (!sql) return null;
  const rows = await sql`
    SELECT * FROM subscriptions
    WHERE user_id = ${userId} AND status IN ('active', 'trialing', 'past_due')
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Gracefully close the database connection pool.
 */
export async function closeDb(): Promise<void> {
  if (sql) await sql.end();
}
