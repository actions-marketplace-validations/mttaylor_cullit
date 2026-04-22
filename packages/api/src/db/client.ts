/**
 * Database client + migrations.
 *
 * Owns the postgres connection pool, the `sql` template tag,
 * and the schema bootstrap. Other modules in `db/*.ts` import
 * `sql` from here.
 */

import postgres from 'postgres';
import { createHash } from 'crypto';
import { log } from '../logger.js';

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
  await sql`ALTER TABLE users ALTER COLUMN api_key DROP NOT NULL`.catch(() => {});

  await sql`
    UPDATE users SET api_key_hash = encode(sha256(api_key::bytea), 'hex')
    WHERE api_key_hash IS NULL AND api_key IS NOT NULL
  `.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to backfill api_key_hash'); });

  await sql`
    UPDATE users SET api_key = NULL
    WHERE api_key IS NOT NULL AND api_key_hash IS NOT NULL
  `.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to clear plaintext api_keys'); });

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
  await sql`CREATE INDEX IF NOT EXISTS idx_generations_project ON generations (project)`.catch(() => {});

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
      user_id         TEXT NOT NULL REFERENCES users(id),
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
      created_by      TEXT NOT NULL REFERENCES users(id),
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

  await sql`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL
    )
  `;

  await sql`DELETE FROM revoked_tokens WHERE expires_at < NOW()`.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to prune expired revoked tokens'); });
  await sql`CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens (user_id)`.catch(() => {});

  await sql`
    CREATE TABLE IF NOT EXISTS webhook_events (
      stripe_event_id TEXT PRIMARY KEY,
      event_type      TEXT NOT NULL,
      processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`DELETE FROM webhook_events WHERE processed_at < NOW() - INTERVAL '30 days'`.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to prune old webhook events'); });

  await sql`
    CREATE TABLE IF NOT EXISTS email_throttle (
      recipient   TEXT NOT NULL,
      sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_throttle_recipient_time ON email_throttle (recipient, sent_at DESC)`.catch(() => {});
  await sql`DELETE FROM email_throttle WHERE sent_at < NOW() - INTERVAL '1 day'`.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to prune old email throttle entries'); });

  await sql`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state       TEXT PRIMARY KEY,
      return_to   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '1 hour'`.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to prune expired oauth_states'); });

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
  await sql`ALTER TABLE team_api_keys ALTER COLUMN api_key DROP NOT NULL`.catch(() => {});
  await sql`ALTER TABLE team_api_keys DROP CONSTRAINT IF EXISTS team_api_keys_api_key_key`.catch(() => {});
  await sql`CREATE INDEX IF NOT EXISTS idx_team_keys_org ON team_api_keys (org_id) WHERE revoked_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_team_keys_api_key ON team_api_keys (api_key) WHERE revoked_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_team_keys_hash ON team_api_keys (api_key_hash) WHERE revoked_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_team_keys_org_created ON team_api_keys (org_id, created_at DESC)`.catch(() => {});
  await sql`CREATE INDEX IF NOT EXISTS idx_team_keys_org_all ON team_api_keys (org_id)`.catch(() => {});
  await sql`CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members (user_id)`.catch(() => {});

  await sql`
    UPDATE team_api_keys SET api_key_hash = encode(sha256(api_key::bytea), 'hex')
    WHERE api_key_hash IS NULL AND api_key IS NOT NULL
  `.catch((err) => { log.warn({ err: (err as Error).message }, 'Failed to backfill team api_key_hash'); });

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

  await sql`ALTER TABLE release_drafts ADD CONSTRAINT fk_drafts_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE`.catch(() => {});
  await sql`ALTER TABLE project_settings ADD CONSTRAINT fk_project_settings_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE`.catch(() => {});
  await sql`ALTER TABLE project_templates ADD CONSTRAINT fk_templates_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE`.catch(() => {});

  // --- Stored procedure: atomic user deletion (GDPR) ---
  await sql`
    CREATE OR REPLACE FUNCTION delete_user_cascade(p_user_id TEXT)
    RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      DELETE FROM org_members WHERE user_id = p_user_id;
      UPDATE generations SET user_id = 'deleted' WHERE user_id = p_user_id;
      DELETE FROM subscriptions WHERE user_id = p_user_id;
      DELETE FROM release_drafts WHERE user_id = p_user_id;
      DELETE FROM project_settings WHERE user_id = p_user_id;
      DELETE FROM org_invites WHERE created_by = p_user_id;
      DELETE FROM revoked_tokens WHERE user_id = p_user_id;
      UPDATE github_installations SET user_id = NULL WHERE user_id = p_user_id;
      UPDATE audit_events SET user_id = NULL WHERE user_id = p_user_id;
      DELETE FROM users WHERE id = p_user_id;
    END;
    $$
  `;

  log.info('Database migrations complete');
}

// --- Periodic table cleanup (runs every hour) ---
const CLEANUP_INTERVAL = 60 * 60 * 1000;

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

/** Gracefully close the database connection pool. */
export async function closeDb(): Promise<void> {
  if (sql) await sql.end();
}
