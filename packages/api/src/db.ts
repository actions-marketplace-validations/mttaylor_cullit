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
import { createHash } from 'crypto';
import { log } from './logger.js';

/** SHA-256 hash of an API key for secure storage and lookup. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

const DATABASE_URL = process.env['DATABASE_URL'] || '';

if (!DATABASE_URL) {
  log.warn('DATABASE_URL is not set — database features are disabled.');
}

export const sql = DATABASE_URL
  ? postgres(DATABASE_URL, {
      max: parseInt(process.env['DB_POOL_SIZE'] || '25', 10) || 25,
      idle_timeout: 30,
      connect_timeout: 3,
      types: { bigint: postgres.BigInt },
      ssl: process.env['NODE_ENV'] === 'production' ? { rejectUnauthorized: false } : undefined,
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
      api_key       TEXT UNIQUE,
      api_key_hash  TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      github_username TEXT,
      preferred_provider TEXT,
      tokens_revoked_before TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Post-hoc migrations for existing databases (columns already in CREATE TABLE above)
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_hash TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_revoked_before TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS github_username TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_provider TEXT`;

  // Drop NOT NULL on api_key so we can null out plaintext keys after hashing
  await sql`ALTER TABLE users ALTER COLUMN api_key DROP NOT NULL`.catch(() => {});

  // Backfill api_key_hash for existing users that don't have one
  // Backfill api_key_hash for existing users that don't have one
  await sql`
    UPDATE users SET api_key_hash = encode(sha256(api_key::bytea), 'hex')
    WHERE api_key_hash IS NULL AND api_key IS NOT NULL
  `.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to backfill api_key_hash'); });

  // Null out plaintext api_key for rows that already have a hash
  await sql`
    UPDATE users SET api_key = NULL
    WHERE api_key IS NOT NULL AND api_key_hash IS NOT NULL
  `.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to clear plaintext api_keys'); });

  // Null out plaintext team API keys where hash already exists
  await sql`
    UPDATE team_api_keys SET api_key = NULL
    WHERE api_key IS NOT NULL AND api_key_hash IS NOT NULL
  `.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to clear plaintext team api_keys'); });

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_hash ON users (api_key_hash) WHERE api_key_hash IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_api_key ON users (api_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_login ON users (login)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_github_username ON users (github_username) WHERE github_username IS NOT NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS orgs (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      slug       TEXT UNIQUE NOT NULL,
      owner_id   TEXT NOT NULL REFERENCES users(id),
      tier       TEXT NOT NULL DEFAULT 'team',
      max_seats  INT NOT NULL DEFAULT 10,
      require_separate_approver BOOLEAN NOT NULL DEFAULT FALSE,
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
      user_id      TEXT,
      PRIMARY KEY (project, version)
    )
  `;

  await sql`ALTER TABLE changelog_releases ADD COLUMN IF NOT EXISTS user_id TEXT`.catch((err) => { log.debug({ err: (err as Error).message }, 'ALTER TABLE changelog_releases user_id'); });
  await sql`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS require_separate_approver BOOLEAN NOT NULL DEFAULT FALSE`.catch((err) => { log.debug({ err: (err as Error).message }, 'ALTER TABLE orgs require_separate_approver'); });

  await sql`CREATE INDEX IF NOT EXISTS idx_changelog_project ON changelog_releases (project, published_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_changelog_releases_user ON changelog_releases (user_id, published_at DESC)`.catch(() => {});

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

  // --- Team workflow tables ---

  await sql`
    CREATE TABLE IF NOT EXISTS release_drafts (
      id              TEXT PRIMARY KEY,
      org_id          TEXT,
      user_id         TEXT NOT NULL REFERENCES users(id),  -- owner: who the draft belongs to (for access control)
      project         TEXT NOT NULL,
      version         TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'draft',
      source_type     TEXT NOT NULL DEFAULT 'local',
      provider        TEXT NOT NULL DEFAULT 'none',
      model           TEXT NOT NULL DEFAULT '',
      audience        TEXT NOT NULL DEFAULT 'developer',
      tone            TEXT NOT NULL DEFAULT 'professional',
      notes_json      JSONB NOT NULL DEFAULT '[]',
      formatted_md    TEXT NOT NULL DEFAULT '',
      formatted_html  TEXT NOT NULL DEFAULT '',
      raw_inputs_json JSONB,
      created_by      TEXT NOT NULL REFERENCES users(id),  -- author: who initially created the draft
      approved_by     TEXT,
      published_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_drafts_user ON release_drafts (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drafts_org ON release_drafts (org_id, created_at DESC) WHERE org_id IS NOT NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS draft_revisions (
      id              TEXT PRIMARY KEY,
      draft_id        TEXT NOT NULL REFERENCES release_drafts(id) ON DELETE CASCADE,
      revision_number INT NOT NULL,
      notes_json      JSONB NOT NULL DEFAULT '[]',
      formatted_md    TEXT NOT NULL DEFAULT '',
      formatted_html  TEXT NOT NULL DEFAULT '',
      changed_by      TEXT NOT NULL REFERENCES users(id),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_revisions_draft ON draft_revisions (draft_id, revision_number)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_revisions_draft_unique ON draft_revisions (draft_id, revision_number)`;

  await sql`
    CREATE TABLE IF NOT EXISTS project_settings (
      id                TEXT PRIMARY KEY,
      org_id            TEXT,
      user_id           TEXT NOT NULL REFERENCES users(id),
      project           TEXT NOT NULL,
      default_source    TEXT NOT NULL DEFAULT 'local',
      default_provider  TEXT NOT NULL DEFAULT 'none',
      default_model     TEXT NOT NULL DEFAULT '',
      default_audience  TEXT NOT NULL DEFAULT 'developer',
      default_tone      TEXT NOT NULL DEFAULT 'professional',
      categories_json   JSONB NOT NULL DEFAULT '[]',
      publish_targets_json JSONB NOT NULL DEFAULT '[]',
      widget_config_json   JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_project_settings_owner ON project_settings (COALESCE(org_id, user_id), project)`;

  await sql`
    CREATE TABLE IF NOT EXISTS org_invites (
      id          TEXT PRIMARY KEY,
      org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      email       TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'member',
      token       TEXT UNIQUE NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_by  TEXT NOT NULL REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_invites_org ON org_invites (org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_invites_token ON org_invites (token) WHERE accepted_at IS NULL`;

  // JWT token revocation table (blacklist for logged-out / rotated tokens)
  await sql`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL
    )
  `;

  // Auto-prune expired revoked tokens (no longer needed once JWT naturally expires)
  await sql`DELETE FROM revoked_tokens WHERE expires_at < NOW()`.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to prune expired revoked tokens'); });
  await sql`CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens (user_id)`.catch(() => {});

  // Stripe webhook idempotency table
  await sql`
    CREATE TABLE IF NOT EXISTS webhook_events (
      stripe_event_id TEXT PRIMARY KEY,
      event_type      TEXT NOT NULL,
      processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Auto-prune webhook events older than 30 days
  await sql`DELETE FROM webhook_events WHERE processed_at < NOW() - INTERVAL '30 days'`.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to prune old webhook events'); });

  // GitHub App installation tracking
  await sql`
    CREATE TABLE IF NOT EXISTS github_installations (
      installation_id  INT PRIMARY KEY,
      user_id          TEXT REFERENCES users(id),
      github_login     TEXT NOT NULL,
      repos            JSONB NOT NULL DEFAULT '[]',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_gh_install_user ON github_installations (user_id)`;

  // Seat-based team API keys
  await sql`
    CREATE TABLE IF NOT EXISTS team_api_keys (
      id                TEXT PRIMARY KEY,
      org_id            TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      api_key           TEXT UNIQUE NOT NULL,
      api_key_hash      TEXT,
      label             TEXT NOT NULL DEFAULT '',
      assigned_to_email TEXT,
      assigned_to_name  TEXT,
      assigned_at       TIMESTAMPTZ,
      revoked_at        TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE team_api_keys ADD COLUMN IF NOT EXISTS api_key_hash TEXT`.catch((err) => { log.debug({ err: (err as Error).message }, 'ALTER TABLE team_api_keys api_key_hash'); });
  // api_key should be nullable (plaintext is scrubbed after hashing) and not unique (multiple NULLs)
  await sql`ALTER TABLE team_api_keys ALTER COLUMN api_key DROP NOT NULL`.catch(() => {});
  await sql`ALTER TABLE team_api_keys DROP CONSTRAINT IF EXISTS team_api_keys_api_key_key`.catch(() => {});
  await sql`CREATE INDEX IF NOT EXISTS idx_team_keys_org ON team_api_keys (org_id) WHERE revoked_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_team_keys_api_key ON team_api_keys (api_key) WHERE revoked_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_team_keys_hash ON team_api_keys (api_key_hash) WHERE revoked_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_team_keys_org_created ON team_api_keys (org_id, created_at DESC)`.catch(() => {});

  // Backfill team api_key_hash for existing keys that don't have one
  await sql`
    UPDATE team_api_keys SET api_key_hash = encode(sha256(api_key::bytea), 'hex')
    WHERE api_key_hash IS NULL AND api_key IS NOT NULL
  `.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to backfill team api_key_hash'); });

  // Audit events table for tracking security-sensitive operations
  await sql`
    CREATE TABLE IF NOT EXISTS audit_events (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      action     TEXT NOT NULL,
      target     TEXT,
      metadata   JSONB,
      ip         TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_events_user ON audit_events (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events (action, created_at DESC)`.catch(() => {});

  // Project templates table
  await sql`
    CREATE TABLE IF NOT EXISTS project_templates (
      id         TEXT PRIMARY KEY,
      org_id     TEXT NOT NULL,
      name       TEXT NOT NULL,
      config     JSONB NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_project_templates_org ON project_templates (org_id)`;

  // Add FK constraints on org_id columns that reference orgs(id)
  await sql`ALTER TABLE release_drafts ADD CONSTRAINT fk_drafts_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE`.catch(() => {});
  await sql`ALTER TABLE project_settings ADD CONSTRAINT fk_project_settings_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE`.catch(() => {});
  await sql`ALTER TABLE project_templates ADD CONSTRAINT fk_templates_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE`.catch(() => {});

  log.info('Database migrations complete');
}

// --- Periodic table cleanup (runs every hour) ---
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

if (sql) {
  setInterval(async () => {
    try {
      await sql`DELETE FROM revoked_tokens WHERE expires_at < NOW()`;
      await sql`DELETE FROM webhook_events WHERE processed_at < NOW() - INTERVAL '30 days'`;
      await sql`DELETE FROM audit_events WHERE created_at < NOW() - INTERVAL '90 days'`.catch(() => {});
      await sql`DELETE FROM usage_daily WHERE date < CURRENT_DATE - INTERVAL '2 years'`.catch(() => {});
      log.info('Periodic DB cleanup: pruned expired tokens, old webhook events, audit logs, and stale usage records');
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'Periodic DB cleanup failed');
    }
  }, CLEANUP_INTERVAL).unref();
}

// --- Token revocation DB operations ---

export async function dbRevokeToken(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO revoked_tokens (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, ${expiresAt})
    ON CONFLICT (token_hash) DO NOTHING
  `;
}

export async function dbIsTokenRevoked(tokenHash: string): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql`SELECT 1 FROM revoked_tokens WHERE token_hash = ${tokenHash}`;
  return rows.length > 0;
}

export async function dbRevokeAllUserTokens(userId: string): Promise<void> {
  if (!sql) return;
  await sql`UPDATE users SET tokens_revoked_before = NOW() WHERE id = ${userId}`;
}

export async function dbGetTokensRevokedBefore(userId: string): Promise<Date | null> {
  if (!sql) return null;
  const rows = await sql<{ tokens_revoked_before: Date | null }[]>`SELECT tokens_revoked_before FROM users WHERE id = ${userId}`;
  return rows[0]?.tokens_revoked_before || null;
}

// --- Webhook idempotency DB operations ---

export async function dbCheckWebhookProcessed(eventId: string): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql`SELECT 1 FROM webhook_events WHERE stripe_event_id = ${eventId}`;
  return rows.length > 0;
}

export async function dbMarkWebhookProcessed(eventId: string, eventType: string): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO webhook_events (stripe_event_id, event_type)
    VALUES (${eventId}, ${eventType})
    ON CONFLICT (stripe_event_id) DO NOTHING
  `;
}

// --- Audit events ---

export async function dbRecordAuditEvent(event: {
  userId?: string | null; action: string; target?: string | null;
  metadata?: Record<string, unknown> | null; ip?: string | null;
}): Promise<void> {
  if (!sql) return;
  const id = `ae_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await sql`
    INSERT INTO audit_events (id, user_id, action, target, metadata, ip)
    VALUES (${id}, ${event.userId || null}, ${event.action}, ${event.target || null},
            ${event.metadata ? JSON.stringify(event.metadata) : null}::jsonb, ${event.ip || null})
  `.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to record audit event'); });
}

export async function dbGetAuditEvents(userId: string, limit: number, offset: number): Promise<{
  events: { id: string; action: string; target: string | null; metadata: Record<string, unknown> | null; ip: string | null; created_at: string }[];
  total: number;
}> {
  if (!sql) return { events: [], total: 0 };
  const countRows = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM audit_events WHERE user_id = ${userId}`;
  const total = parseInt(countRows[0].count, 10);
  const rows = await sql<{ id: string; action: string; target: string | null; metadata: Record<string, unknown> | null; ip: string | null; created_at: Date }[]>`
    SELECT id, action, target, metadata, ip, created_at FROM audit_events
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return {
    events: rows.map(r => ({ ...r, created_at: r.created_at.toISOString() })),
    total,
  };
}

// --- Project templates ---

export interface DbProjectTemplate {
  id: string;
  org_id: string;
  name: string;
  config: Record<string, unknown>;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export async function dbCreateProjectTemplate(template: {
  id: string; orgId: string; name: string; config: Record<string, unknown>; createdBy: string;
}): Promise<DbProjectTemplate> {
  const rows = await sql<DbProjectTemplate[]>`
    INSERT INTO project_templates (id, org_id, name, config, created_by)
    VALUES (${template.id}, ${template.orgId}, ${template.name},
            ${JSON.stringify(template.config)}::jsonb, ${template.createdBy})
    RETURNING *
  `;
  return rows[0];
}

export async function dbListProjectTemplates(orgId: string): Promise<DbProjectTemplate[]> {
  return sql<DbProjectTemplate[]>`
    SELECT * FROM project_templates WHERE org_id = ${orgId} ORDER BY name
  `;
}

export async function dbGetProjectTemplate(id: string, orgId: string): Promise<DbProjectTemplate | null> {
  const rows = await sql<DbProjectTemplate[]>`
    SELECT * FROM project_templates WHERE id = ${id} AND org_id = ${orgId}
  `;
  return rows[0] || null;
}

export async function dbDeleteProjectTemplate(id: string, orgId: string): Promise<boolean> {
  const result = await sql`DELETE FROM project_templates WHERE id = ${id} AND org_id = ${orgId}`;
  return result.count > 0;
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
  github_username: string | null;
  preferred_provider: string | null;
  created_at: Date;
  last_login_at: Date;
}

export async function dbGetUser(id: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] || null;
}

export async function dbGetUserByApiKey(apiKey: string): Promise<DbUser | null> {
  const keyHash = hashApiKey(apiKey);
  // Look up by hash only — plaintext fallback removed for security
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE api_key_hash = ${keyHash}`;
  return rows[0] || null;
}

export async function dbGetUserByStripeCustomer(customerId: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE stripe_customer_id = ${customerId}`;
  return rows[0] || null;
}

export async function dbGetUserByLogin(login: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE login = ${login}`;
  return rows[0] || null;
}

export async function dbGetUserByGithubUsername(username: string): Promise<DbUser | null> {
  const rows = await sql<DbUser[]>`SELECT * FROM users WHERE github_username = ${username}`;
  return rows[0] || null;
}

export async function dbUpdateGithubUsername(userId: string, githubUsername: string): Promise<void> {
  await sql`UPDATE users SET github_username = ${githubUsername} WHERE id = ${userId}`;
}

export async function dbUpsertUser(user: {
  id: string; login: string; name: string; email: string;
  avatarUrl: string; apiKey: string;
  githubUsername?: string | null;
}): Promise<DbUser> {
  const keyHash = hashApiKey(user.apiKey);
  const rows = await sql<DbUser[]>`
    INSERT INTO users (id, login, name, email, avatar_url, api_key, api_key_hash, github_username)
    VALUES (${user.id}, ${user.login}, ${user.name}, ${user.email}, ${user.avatarUrl}, ${user.apiKey}, ${keyHash}, ${user.githubUsername || null})
    ON CONFLICT (id) DO UPDATE SET
      login = EXCLUDED.login,
      name = EXCLUDED.name,
      email = CASE WHEN EXCLUDED.email != '' THEN EXCLUDED.email ELSE users.email END,
      avatar_url = EXCLUDED.avatar_url,
      github_username = COALESCE(EXCLUDED.github_username, users.github_username),
      api_key_hash = COALESCE(EXCLUDED.api_key_hash, users.api_key_hash),
      api_key = NULL,
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

export async function dbRotateApiKey(userId: string, newApiKey: string): Promise<DbUser> {
  const keyHash = hashApiKey(newApiKey);
  const rows = await sql<DbUser[]>`UPDATE users SET api_key = NULL, api_key_hash = ${keyHash} WHERE id = ${userId} RETURNING *`;
  return rows[0];
}

export async function dbUpdatePreferredProvider(userId: string, provider: string): Promise<void> {
  await sql`UPDATE users SET preferred_provider = ${provider} WHERE id = ${userId}`;
}

// --- Org DB operations ---

export interface DbOrg {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  tier: string;
  max_seats: number;
  require_separate_approver: boolean;
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
  // Use ON CONFLICT to handle slug collisions atomically
  const rows = await sql<DbOrg[]>`
    INSERT INTO orgs (id, name, slug, owner_id, tier, max_seats)
    VALUES (${org.id}, ${org.name}, ${org.slug}, ${org.ownerId}, ${org.tier}, ${org.maxSeats})
    ON CONFLICT (slug) DO NOTHING
    RETURNING *
  `;
  return rows[0];
}

export async function dbUpdateOrgSettings(orgId: string, settings: { requireSeparateApprover: boolean }): Promise<void> {
  await sql`UPDATE orgs SET require_separate_approver = ${settings.requireSeparateApprover} WHERE id = ${orgId}`;
}

export async function dbUpdateOrgMaxSeats(orgId: string, maxSeats: number): Promise<void> {
  await sql`UPDATE orgs SET max_seats = ${maxSeats} WHERE id = ${orgId}`;
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

/**
 * Atomically add org member only if seat count is below max.
 * Prevents race condition where two concurrent invites both pass the seat check.
 */
export async function dbAddOrgMemberAtomic(orgId: string, userId: string, role: string, maxSeats: number): Promise<boolean> {
  try {
    // Advisory lock on org prevents concurrent seat-check races
    const result = await sql.begin(async (tx: any) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;
      return tx`
        INSERT INTO org_members (org_id, user_id, role)
        SELECT ${orgId}, ${userId}, ${role}
        WHERE (SELECT COUNT(*) FROM org_members WHERE org_id = ${orgId}) < ${maxSeats}
      `;
    });
    return result.count > 0;
  } catch {
    return false; // duplicate or constraint violation
  }
}

export async function dbRemoveOrgMember(orgId: string, userId: string): Promise<boolean> {
  const result = await sql`DELETE FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`;
  return result.count > 0;
}

/**
 * GDPR: Delete all user data. Anonymizes history records, removes org membership,
 * deletes subscriptions, drafts, and the user record itself.
 */
export async function dbDeleteUser(userId: string): Promise<void> {
  if (!sql) return;
  // Wrap in a transaction so partial deletes cannot leave orphaned data
  await sql.begin(async (tx: any) => {
    // Remove org memberships (but don't delete orgs the user owns — handled by caller)
    await tx`DELETE FROM org_members WHERE user_id = ${userId}`;
    // Anonymize generation history (keep aggregate stats, remove PII)
    await tx`UPDATE generations SET user_id = 'deleted' WHERE user_id = ${userId}`;
    // Delete subscriptions
    await tx`DELETE FROM subscriptions WHERE user_id = ${userId}`;
    // Delete drafts and their revisions (CASCADE handles revisions)
    await tx`DELETE FROM release_drafts WHERE user_id = ${userId}`;
    // Delete project settings
    await tx`DELETE FROM project_settings WHERE user_id = ${userId}`;
    // Delete org invites created by this user
    await tx`DELETE FROM org_invites WHERE created_by = ${userId}`;
    // Revoke all tokens
    await tx`DELETE FROM revoked_tokens WHERE user_id = ${userId}`;
    // Delete the user record
    await tx`DELETE FROM users WHERE id = ${userId}`;
  });
}

export async function dbGetOrgMembers(orgId: string): Promise<DbUser[]> {
  return sql<DbUser[]>`
    SELECT u.* FROM users u
    JOIN org_members om ON u.id = om.user_id
    WHERE om.org_id = ${orgId}
    ORDER BY om.joined_at
  `;
}

export async function dbUpdateOrgMemberRole(orgId: string, userId: string, role: string): Promise<boolean> {
  const result = await sql`
    UPDATE org_members SET role = ${role}
    WHERE org_id = ${orgId} AND user_id = ${userId}
  `;
  if (result.count === 0) return false;
  await sql`UPDATE users SET role = ${role} WHERE id = ${userId} AND org_id = ${orgId}`;
  return true;
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

export async function dbGetGenerations(userId: string, limit: number, offset: number, cursor?: string): Promise<{
  id: string; user_id: string; project: string; from_ref: string; to_ref: string;
  provider: string; format: string; change_count: number; summary: string; duration: number; created_at: Date;
}[]> {
  if (cursor) {
    // Cursor-based: composite (created_at, id) for stable pagination
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

// --- Changelog DB operations ---

export async function dbGetProjectOwner(project: string): Promise<string | null> {
  const rows = await sql<Array<{ user_id: string }>>`
    SELECT user_id FROM changelog_releases WHERE project = ${project} AND user_id IS NOT NULL LIMIT 1`;
  return rows.length > 0 ? rows[0].user_id : null;
}

export async function dbPublishRelease(project: string, release: {
  version: string; date: string; summary: string;
  changes: { description: string; category: string; ticketKey?: string }[];
  contributors: string[]; metadata?: Record<string, unknown>;
  formattedMd: string; formattedHtml: string;
  userId?: string;
}): Promise<void> {
  await sql`
    INSERT INTO changelog_releases (project, version, date, summary, changes, contributors, metadata, formatted_md, formatted_html, user_id)
    VALUES (${project}, ${release.version}, ${release.date}, ${release.summary},
            ${JSON.stringify(release.changes)}::jsonb, ${JSON.stringify(release.contributors)}::jsonb,
            ${release.metadata ? JSON.stringify(release.metadata) : null}::jsonb,
            ${release.formattedMd}, ${release.formattedHtml}, ${release.userId || null})
    ON CONFLICT (project, version) DO UPDATE SET
      date = EXCLUDED.date,
      summary = EXCLUDED.summary,
      changes = EXCLUDED.changes,
      contributors = EXCLUDED.contributors,
      metadata = EXCLUDED.metadata,
      formatted_md = EXCLUDED.formatted_md,
      formatted_html = EXCLUDED.formatted_html,
      user_id = EXCLUDED.user_id,
      published_at = NOW()
  `;
}

export async function dbGetReleases(project: string, limit: number): Promise<{
  version: string; date: string; summary: string;
  changes: unknown[]; contributors: string[];
  formatted: { markdown: string; html: string };
}[]> {
  interface ChangelogReleaseRow {
    version: string;
    date: string;
    summary: string;
    changes: string | unknown[];
    contributors: string | string[];
    formatted_md: string;
    formatted_html: string;
  }

  const rows = await sql<ChangelogReleaseRow[]>`
    SELECT version, date::text, summary, changes, contributors, formatted_md, formatted_html
    FROM changelog_releases
    WHERE project = ${project}
    ORDER BY published_at DESC
    LIMIT ${limit}
  `;
  return rows.map(r => ({
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

export async function dbGetUserProjectCount(userId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`SELECT COUNT(DISTINCT project)::text AS count FROM changelog_releases WHERE user_id = ${userId}`;
  return parseInt(rows[0].count, 10);
}

export async function dbDeleteRelease(project: string, version: string, userId?: string): Promise<boolean> {
  const result = userId
    ? await sql`DELETE FROM changelog_releases WHERE project = ${project} AND version = ${version} AND user_id = ${userId}`
    : await sql`DELETE FROM changelog_releases WHERE project = ${project} AND version = ${version}`;
  return result.count > 0;
}

export async function dbGetUserProjects(userId: string): Promise<string[]> {
  const rows = await sql<Array<{ project: string }>>`SELECT DISTINCT project FROM changelog_releases WHERE user_id = ${userId} ORDER BY project`;
  return rows.map(r => r.project);
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
  const rows = await sql<{
    id: string; plan: string; status: string;
    stripe_subscription_id: string; stripe_customer_id: string;
    current_period_start: Date | null; current_period_end: Date | null;
    cancel_at_period_end: boolean;
  }[]>`
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

// --- Release Draft DB operations ---

export type DraftStatus = 'draft' | 'submitted' | 'approved' | 'published';

/**
 * Atomically publish a release AND mark the draft as published in a single transaction.
 * Prevents duplicates if the server crashes between the two writes.
 */
export async function dbPublishDraftWithRelease(draftId: string, project: string, release: {
  version: string; date: string; summary: string;
  changes: { description: string; category: string; ticketKey?: string }[];
  contributors: string[];
  formattedMd: string; formattedHtml: string;
}): Promise<DbDraft | null> {
  return sql.begin(async (tx: any) => {
    await tx`
      INSERT INTO changelog_releases (project, version, date, summary, changes, contributors, formatted_md, formatted_html)
      VALUES (${project}, ${release.version}, ${release.date}, ${release.summary},
              ${JSON.stringify(release.changes)}::jsonb, ${JSON.stringify(release.contributors)}::jsonb,
              ${release.formattedMd}, ${release.formattedHtml})
      ON CONFLICT (project, version) DO UPDATE SET
        date = EXCLUDED.date, summary = EXCLUDED.summary, changes = EXCLUDED.changes,
        contributors = EXCLUDED.contributors, formatted_md = EXCLUDED.formatted_md,
        formatted_html = EXCLUDED.formatted_html, published_at = NOW()
    `;
    const rows = await tx<DbDraft[]>`
      UPDATE release_drafts SET status = 'published', published_at = NOW(), updated_at = NOW()
      WHERE id = ${draftId} RETURNING *
    `;
    return rows[0] || null;
  });
}

export interface DbDraft {
  id: string;
  org_id: string | null;
  user_id: string;
  project: string;
  version: string;
  status: DraftStatus;
  source_type: string;
  provider: string;
  model: string;
  audience: string;
  tone: string;
  notes_json: unknown[];
  formatted_md: string;
  formatted_html: string;
  raw_inputs_json: unknown | null;
  created_by: string;
  approved_by: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function dbCreateDraft(draft: {
  id: string; orgId: string | null; userId: string; project: string; version: string;
  sourceType: string; provider: string; model: string; audience: string; tone: string;
  notesJson: unknown[]; formattedMd: string; formattedHtml: string; rawInputsJson?: unknown;
  createdBy: string;
}): Promise<DbDraft> {
  const rows = await sql<DbDraft[]>`
    INSERT INTO release_drafts (id, org_id, user_id, project, version, source_type, provider, model, audience, tone,
      notes_json, formatted_md, formatted_html, raw_inputs_json, created_by)
    VALUES (${draft.id}, ${draft.orgId}, ${draft.userId}, ${draft.project}, ${draft.version},
      ${draft.sourceType}, ${draft.provider}, ${draft.model}, ${draft.audience}, ${draft.tone},
      ${JSON.stringify(draft.notesJson)}::jsonb, ${draft.formattedMd}, ${draft.formattedHtml},
      ${draft.rawInputsJson ? JSON.stringify(draft.rawInputsJson) : null}::jsonb, ${draft.createdBy})
    RETURNING *
  `;
  return rows[0];
}

export async function dbGetDraft(id: string): Promise<DbDraft | null> {
  const rows = await sql<DbDraft[]>`SELECT * FROM release_drafts WHERE id = ${id}`;
  return rows[0] || null;
}

export async function dbListDrafts(opts: {
  userId?: string; orgId?: string; status?: string; limit: number; offset: number;
}): Promise<{ drafts: DbDraft[]; total: number }> {
  // Build query dynamically based on whether we filter by org or user
  let drafts: DbDraft[];
  let total: number;

  if (opts.orgId && opts.status) {
    drafts = await sql<DbDraft[]>`
      SELECT * FROM release_drafts WHERE org_id = ${opts.orgId} AND status = ${opts.status}
      ORDER BY updated_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    const countRows = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM release_drafts WHERE org_id = ${opts.orgId} AND status = ${opts.status}`;
    total = parseInt(countRows[0].count, 10);
  } else if (opts.orgId) {
    drafts = await sql<DbDraft[]>`
      SELECT * FROM release_drafts WHERE org_id = ${opts.orgId}
      ORDER BY updated_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    const countRows = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM release_drafts WHERE org_id = ${opts.orgId}`;
    total = parseInt(countRows[0].count, 10);
  } else if (opts.userId && opts.status) {
    drafts = await sql<DbDraft[]>`
      SELECT * FROM release_drafts WHERE user_id = ${opts.userId} AND status = ${opts.status}
      ORDER BY updated_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    const countRows = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM release_drafts WHERE user_id = ${opts.userId} AND status = ${opts.status}`;
    total = parseInt(countRows[0].count, 10);
  } else if (opts.userId) {
    drafts = await sql<DbDraft[]>`
      SELECT * FROM release_drafts WHERE user_id = ${opts.userId}
      ORDER BY updated_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    const countRows = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM release_drafts WHERE user_id = ${opts.userId}`;
    total = parseInt(countRows[0].count, 10);
  } else {
    drafts = [];
    total = 0;
  }

  return { drafts, total };
}

export async function dbUpdateDraft(id: string, updates: {
  version?: string; notesJson?: unknown[]; formattedMd?: string; formattedHtml?: string;
  audience?: string; tone?: string;
}): Promise<DbDraft | null> {
  const rows = await sql<DbDraft[]>`
    UPDATE release_drafts SET
      version = COALESCE(${updates.version ?? null}, version),
      notes_json = COALESCE(${updates.notesJson ? JSON.stringify(updates.notesJson) : null}::jsonb, notes_json),
      formatted_md = COALESCE(${updates.formattedMd ?? null}, formatted_md),
      formatted_html = COALESCE(${updates.formattedHtml ?? null}, formatted_html),
      audience = COALESCE(${updates.audience ?? null}, audience),
      tone = COALESCE(${updates.tone ?? null}, tone),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0] || null;
}

export async function dbUpdateDraftStatus(id: string, status: DraftStatus, actorId?: string): Promise<DbDraft | null> {
  if (status === 'approved' && actorId) {
    const rows = await sql<DbDraft[]>`
      UPDATE release_drafts SET status = ${status}, approved_by = ${actorId}, updated_at = NOW()
      WHERE id = ${id} AND status = 'submitted' RETURNING *`;
    return rows[0] || null;
  }
  if (status === 'published') {
    const rows = await sql<DbDraft[]>`
      UPDATE release_drafts SET status = ${status}, published_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND status = 'approved' RETURNING *`;
    return rows[0] || null;
  }
  if (status === 'submitted') {
    const rows = await sql<DbDraft[]>`
      UPDATE release_drafts SET status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND status = 'draft' RETURNING *`;
    return rows[0] || null;
  }
  const rows = await sql<DbDraft[]>`
    UPDATE release_drafts SET status = ${status}, updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return rows[0] || null;
}

export async function dbDeleteDraft(id: string): Promise<boolean> {
  const result = await sql`DELETE FROM release_drafts WHERE id = ${id}`;
  return result.count > 0;
}

// --- Draft Revision DB operations ---

export interface DbRevision {
  id: string;
  draft_id: string;
  revision_number: number;
  notes_json: unknown[];
  formatted_md: string;
  formatted_html: string;
  changed_by: string;
  created_at: Date;
}

export async function dbCreateRevision(rev: {
  id: string; draftId: string; revisionNumber: number;
  notesJson: unknown[]; formattedMd: string; formattedHtml: string; changedBy: string;
}): Promise<DbRevision> {
  const rows = await sql<DbRevision[]>`
    INSERT INTO draft_revisions (id, draft_id, revision_number, notes_json, formatted_md, formatted_html, changed_by)
    VALUES (${rev.id}, ${rev.draftId}, ${rev.revisionNumber},
      ${JSON.stringify(rev.notesJson)}::jsonb, ${rev.formattedMd}, ${rev.formattedHtml}, ${rev.changedBy})
    RETURNING *
  `;
  return rows[0];
}

export async function dbGetRevisions(draftId: string): Promise<DbRevision[]> {
  return sql<DbRevision[]>`
    SELECT * FROM draft_revisions WHERE draft_id = ${draftId} ORDER BY revision_number DESC
  `;
}

export async function dbGetRevisionCount(draftId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM draft_revisions WHERE draft_id = ${draftId}`;
  return parseInt(rows[0].count, 10);
}

// --- Project Settings DB operations ---

export interface DbProjectSettings {
  id: string;
  org_id: string | null;
  user_id: string;
  project: string;
  default_source: string;
  default_provider: string;
  default_model: string;
  default_audience: string;
  default_tone: string;
  categories_json: unknown[];
  publish_targets_json: unknown[];
  widget_config_json: unknown | null;
  created_at: Date;
  updated_at: Date;
}

export async function dbGetProjectSettings(ownerId: string, project: string, orgId?: string | null): Promise<DbProjectSettings | null> {
  if (orgId) {
    const rows = await sql<DbProjectSettings[]>`
      SELECT * FROM project_settings WHERE org_id = ${orgId} AND project = ${project}`;
    return rows[0] || null;
  }
  const rows = await sql<DbProjectSettings[]>`
    SELECT * FROM project_settings WHERE user_id = ${ownerId} AND org_id IS NULL AND project = ${project}`;
  return rows[0] || null;
}

export async function dbUpsertProjectSettings(settings: {
  id: string; orgId: string | null; userId: string; project: string;
  defaultSource?: string; defaultProvider?: string; defaultModel?: string;
  defaultAudience?: string; defaultTone?: string;
  categoriesJson?: unknown[]; publishTargetsJson?: unknown[]; widgetConfigJson?: unknown;
}): Promise<DbProjectSettings> {
  const rows = await sql<DbProjectSettings[]>`
    INSERT INTO project_settings (id, org_id, user_id, project, default_source, default_provider, default_model,
      default_audience, default_tone, categories_json, publish_targets_json, widget_config_json)
    VALUES (${settings.id}, ${settings.orgId}, ${settings.userId}, ${settings.project},
      ${settings.defaultSource || 'local'}, ${settings.defaultProvider || 'none'}, ${settings.defaultModel || ''},
      ${settings.defaultAudience || 'developer'}, ${settings.defaultTone || 'professional'},
      ${JSON.stringify(settings.categoriesJson || [])}::jsonb, ${JSON.stringify(settings.publishTargetsJson || [])}::jsonb,
      ${settings.widgetConfigJson ? JSON.stringify(settings.widgetConfigJson) : null}::jsonb)
    ON CONFLICT (COALESCE(org_id, user_id), project) DO UPDATE SET
      default_source = EXCLUDED.default_source,
      default_provider = EXCLUDED.default_provider,
      default_model = EXCLUDED.default_model,
      default_audience = EXCLUDED.default_audience,
      default_tone = EXCLUDED.default_tone,
      categories_json = EXCLUDED.categories_json,
      publish_targets_json = EXCLUDED.publish_targets_json,
      widget_config_json = EXCLUDED.widget_config_json,
      updated_at = NOW()
    RETURNING *
  `;
  return rows[0];
}

export async function dbListProjectSettings(ownerId: string, orgId?: string | null): Promise<DbProjectSettings[]> {
  if (orgId) {
    return sql<DbProjectSettings[]>`SELECT * FROM project_settings WHERE org_id = ${orgId} ORDER BY project`;
  }
  return sql<DbProjectSettings[]>`SELECT * FROM project_settings WHERE user_id = ${ownerId} AND org_id IS NULL ORDER BY project`;
}

// --- Org Invites DB operations ---

export interface DbOrgInvite {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_by: string;
  created_at: Date;
}

export async function dbCreateOrgInvite(invite: {
  id: string; orgId: string; email: string; role: string; token: string; expiresAt: Date; createdBy: string;
}): Promise<DbOrgInvite> {
  const rows = await sql<DbOrgInvite[]>`
    INSERT INTO org_invites (id, org_id, email, role, token, expires_at, created_by)
    VALUES (${invite.id}, ${invite.orgId}, ${invite.email}, ${invite.role}, ${invite.token}, ${invite.expiresAt}, ${invite.createdBy})
    RETURNING *
  `;
  return rows[0];
}

export async function dbListOrgInvites(orgId: string): Promise<DbOrgInvite[]> {
  return sql<DbOrgInvite[]>`
    SELECT * FROM org_invites WHERE org_id = ${orgId} AND accepted_at IS NULL AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
}

export async function dbGetOrgInviteByToken(token: string): Promise<DbOrgInvite | null> {
  const rows = await sql<DbOrgInvite[]>`
    SELECT * FROM org_invites WHERE token = ${token} AND accepted_at IS NULL AND expires_at > NOW()`;
  return rows[0] || null;
}

export async function dbAcceptOrgInvite(id: string): Promise<boolean> {
  const result = await sql`UPDATE org_invites SET accepted_at = NOW() WHERE id = ${id}`;
  return result.count > 0;
}

export async function dbDeleteOrgInvite(id: string, orgId?: string): Promise<boolean> {
  const result = orgId
    ? await sql`DELETE FROM org_invites WHERE id = ${id} AND org_id = ${orgId}`
    : await sql`DELETE FROM org_invites WHERE id = ${id}`;
  return result.count > 0;
}

// --- Team API key DB operations ---

export interface DbTeamApiKey {
  id: string;
  org_id: string;
  api_key: string;
  label: string;
  assigned_to_email: string | null;
  assigned_to_name: string | null;
  assigned_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export async function dbCreateTeamApiKey(key: {
  id: string; orgId: string; apiKey: string; label: string;
}): Promise<DbTeamApiKey> {
  const keyHash = hashApiKey(key.apiKey);
  const rows = await sql<DbTeamApiKey[]>`
    INSERT INTO team_api_keys (id, org_id, api_key, api_key_hash, label)
    VALUES (${key.id}, ${key.orgId}, ${key.apiKey}, ${keyHash}, ${key.label})
    RETURNING *
  `;
  return rows[0];
}

export async function dbGetTeamApiKeys(orgId: string): Promise<DbTeamApiKey[]> {
  return sql<DbTeamApiKey[]>`
    SELECT * FROM team_api_keys WHERE org_id = ${orgId} ORDER BY created_at
  `;
}

export async function dbGetActiveTeamApiKeyCount(orgId: string): Promise<number> {
  const rows = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM team_api_keys WHERE org_id = ${orgId} AND revoked_at IS NULL
  `;
  return parseInt(rows[0].count, 10);
}

export async function dbGetTeamApiKeyByKey(apiKey: string): Promise<DbTeamApiKey | null> {
  const keyHash = hashApiKey(apiKey);
  // Hash-only lookup — plaintext fallback removed for security
  const rows = await sql<DbTeamApiKey[]>`
    SELECT * FROM team_api_keys WHERE api_key_hash = ${keyHash} AND revoked_at IS NULL
  `;
  return rows[0] || null;
}

export async function dbUpdateTeamApiKeyAssignment(
  id: string, orgId: string, email: string | null, name: string | null,
): Promise<DbTeamApiKey | null> {
  const rows = await sql<DbTeamApiKey[]>`
    UPDATE team_api_keys
    SET assigned_to_email = ${email}, assigned_to_name = ${name},
        assigned_at = ${email ? sql`NOW()` : null}
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING *
  `;
  return rows[0] || null;
}

export async function dbUpdateTeamApiKeyLabel(
  id: string, orgId: string, label: string,
): Promise<DbTeamApiKey | null> {
  const rows = await sql<DbTeamApiKey[]>`
    UPDATE team_api_keys SET label = ${label} WHERE id = ${id} AND org_id = ${orgId} RETURNING *
  `;
  return rows[0] || null;
}

export async function dbRevokeTeamApiKey(id: string, orgId: string): Promise<boolean> {
  const result = await sql`
    UPDATE team_api_keys SET revoked_at = NOW() WHERE id = ${id} AND org_id = ${orgId} AND revoked_at IS NULL
  `;
  return result.count > 0;
}

export async function dbRevokeAllOrgTeamApiKeys(orgId: string): Promise<number> {
  const result = await sql`
    UPDATE team_api_keys SET revoked_at = NOW() WHERE org_id = ${orgId} AND revoked_at IS NULL
  `;
  return result.count;
}

export async function dbRevokeExcessTeamApiKeys(orgId: string, maxActive: number): Promise<number> {
  const result = await sql`
    UPDATE team_api_keys SET revoked_at = NOW()
    WHERE id IN (
      SELECT id FROM team_api_keys
      WHERE org_id = ${orgId} AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT (
        SELECT GREATEST(0, COUNT(*) - ${maxActive})
        FROM team_api_keys WHERE org_id = ${orgId} AND revoked_at IS NULL
      )
    )
  `;
  return result.count;
}

export async function dbRotateTeamApiKey(id: string, orgId: string, newApiKey: string): Promise<DbTeamApiKey | null> {
  const rows = await sql<DbTeamApiKey[]>`
    UPDATE team_api_keys SET api_key = ${newApiKey}, api_key_hash = ${hashApiKey(newApiKey)} WHERE id = ${id} AND org_id = ${orgId} AND revoked_at IS NULL RETURNING *
  `;
  return rows[0] || null;
}
