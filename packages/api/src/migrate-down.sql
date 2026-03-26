/**
 * Cullit Database — Down Migrations
 *
 * Reverse migrations for emergency rollback. Run these MANUALLY (never on startup).
 * Each section drops tables/columns added by the corresponding up migration in db.ts.
 *
 * Usage:
 *   psql $DATABASE_URL -f packages/api/src/migrate-down.sql
 *
 * WARNING: These are destructive operations. Back up your data first.
 *   pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
 */

-- ============================================
-- Phase 1: Drop Team workflow tables (v1.8+)
-- Safe to rollback — only affects team features
-- ============================================

-- Drop indexes first
DROP INDEX IF EXISTS idx_invites_token;
DROP INDEX IF EXISTS idx_invites_org;
DROP INDEX IF EXISTS idx_revisions_draft;
DROP INDEX IF EXISTS idx_drafts_org;
DROP INDEX IF EXISTS idx_drafts_user;

-- Drop tables in dependency order
DROP TABLE IF EXISTS org_invites CASCADE;
DROP TABLE IF EXISTS draft_revisions CASCADE;
DROP TABLE IF EXISTS release_drafts CASCADE;
DROP TABLE IF EXISTS project_settings CASCADE;

-- ============================================
-- Phase 2: Drop billing tables (v1.6+)
-- ============================================

DROP INDEX IF EXISTS idx_subscriptions_stripe;
DROP INDEX IF EXISTS idx_subscriptions_user;
DROP TABLE IF EXISTS subscriptions CASCADE;

-- ============================================
-- Phase 3: Drop changelog tables (v1.4+)
-- ============================================

DROP INDEX IF EXISTS idx_changelog_project;
DROP TABLE IF EXISTS changelog_releases CASCADE;

-- ============================================
-- Phase 4: Drop analytics tables (v1.2+)
-- ============================================

DROP TABLE IF EXISTS usage_daily CASCADE;

-- ============================================
-- Phase 5: Drop core tables (v1.0)
-- !! This is a FULL RESET — all data is lost !!
-- ============================================

DROP INDEX IF EXISTS idx_generations_user;
DROP TABLE IF EXISTS generations CASCADE;
DROP TABLE IF EXISTS org_members CASCADE;
DROP TABLE IF EXISTS orgs CASCADE;
DROP INDEX IF EXISTS idx_users_stripe_customer;
DROP INDEX IF EXISTS idx_users_api_key;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- Column-level rollbacks (if only rolling back ALTER TABLE additions)
-- Use these instead of full table drops for minor rollbacks
-- ============================================

-- Rollback trial columns:
-- ALTER TABLE users DROP COLUMN IF EXISTS trial_tier;
-- ALTER TABLE users DROP COLUMN IF EXISTS trial_starts_at;
-- ALTER TABLE users DROP COLUMN IF EXISTS trial_ends_at;
-- ALTER TABLE users DROP COLUMN IF EXISTS trial_converted_at;

-- Rollback changelog user_id:
-- ALTER TABLE changelog_releases DROP COLUMN IF EXISTS user_id;
