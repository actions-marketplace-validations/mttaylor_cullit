# Database Schema

Cullit uses PostgreSQL for production persistence. Set `DATABASE_URL` to enable database mode. Without it, the API falls back to file-backed JSON stores (ephemeral on container restart).

Connection pool: max 25, idle timeout 30s, connect timeout 3s.

## Tables

### `users`

GitHub OAuth users and API keys.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | User ID |
| `login` | TEXT | GitHub/OAuth login |
| `name` | TEXT | Display name |
| `email` | TEXT | Email address |
| `avatar_url` | TEXT | Profile avatar |
| `tier` | TEXT | `free`, `pro`, `enterprise` (legacy `paid`, `pro` and `team` are mapped to `pro` at read time) |
| `org_id` | TEXT | FK → `orgs.id` (nullable) |
| `role` | TEXT | `member` or `admin` |
| `api_key` | TEXT UNIQUE | CULLIT_API_KEY value (deprecated — see `api_key_hash`) |
| `api_key_hash` | TEXT | SHA-256 hash of API key (used for lookups after key rotation) |
| `stripe_customer_id` | TEXT | Stripe customer link |
| `stripe_subscription_id` | TEXT | Stripe subscription link |
| `github_username` | TEXT | GitHub username (for app linking) |
| `created_at` | TIMESTAMPTZ | Account creation |
| `last_login_at` | TIMESTAMPTZ | Last login timestamp |

Indexes: `idx_users_api_key (api_key)`, `idx_users_api_key_hash (api_key_hash)`, `idx_users_stripe_customer (stripe_customer_id)`

---

### `orgs`

Organizations / teams.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Org ID |
| `name` | TEXT | Display name |
| `slug` | TEXT UNIQUE | URL slug |
| `owner_id` | TEXT | FK → `users.id` |
| `tier` | TEXT | `pro` or `enterprise` |
| `max_seats` | INT | Seat limit (default 10) |
| `require_separate_approver` | BOOLEAN | Require different user to approve drafts |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

---

### `org_members`

Org membership join table.

| Column | Type | Notes |
|--------|------|-------|
| `org_id` | TEXT | FK → `orgs.id` (CASCADE) |
| `user_id` | TEXT | FK → `users.id` (CASCADE) |
| `role` | TEXT | `member`, `admin`, `owner` |
| `joined_at` | TIMESTAMPTZ | When member joined |

Primary key: `(org_id, user_id)`

---

### `generations`

Per-user generation history.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Generation ID |
| `user_id` | TEXT | FK → `users.id` |
| `project` | TEXT | Project name |
| `from_ref` | TEXT | Start ref (tag/SHA) |
| `to_ref` | TEXT | End ref |
| `provider` | TEXT | AI provider used |
| `format` | TEXT | Output format |
| `change_count` | INT | Number of changes |
| `summary` | TEXT | 500-char summary |
| `duration` | INT | Generation time (ms) |
| `created_at` | TIMESTAMPTZ | When generated |

Index: `idx_generations_user (user_id, created_at DESC)`

---

### `usage_daily`

Aggregated daily usage analytics.

| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT | User or org identifier |
| `date` | DATE | Calendar date |
| `generations` | INT | Count of generations |
| `total_changes` | INT | Sum of changes processed |
| `avg_duration` | INT | Average generation time (ms) |
| `providers` | JSONB | Provider breakdown `{"anthropic": 5, "openai": 3}` |

Primary key: `(key, date)`

---

### `changelog_releases`

Published changelog entries.

| Column | Type | Notes |
|--------|------|-------|
| `project` | TEXT | Project name |
| `version` | TEXT | Semver version |
| `date` | DATE | Release date |
| `summary` | TEXT | Release summary |
| `changes` | JSONB | Array of change objects |
| `contributors` | JSONB | Array of contributor names |
| `metadata` | JSONB | Optional metadata |
| `formatted_md` | TEXT | Markdown output |
| `formatted_html` | TEXT | HTML output |
| `published_at` | TIMESTAMPTZ | Publication timestamp |
| `user_id` | TEXT | Publishing user (nullable) |

Primary key: `(project, version)`
Index: `idx_changelog_project (project, published_at DESC)`

---

### `subscriptions`

Stripe billing state.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Subscription record ID |
| `user_id` | TEXT | FK → `users.id` |
| `stripe_subscription_id` | TEXT UNIQUE | Stripe subscription ID |
| `stripe_customer_id` | TEXT | Stripe customer ID |
| `plan` | TEXT | `free`, `pro` (legacy `paid`, `pro` and `team` are mapped to `pro`) |
| `status` | TEXT | `active`, `past_due`, `canceled` |
| `current_period_start` | TIMESTAMPTZ | Billing period start |
| `current_period_end` | TIMESTAMPTZ | Billing period end |
| `cancel_at_period_end` | BOOLEAN | Pending cancellation |
| `created_at` | TIMESTAMPTZ | Record creation |
| `updated_at` | TIMESTAMPTZ | Last update |

Indexes: `idx_subscriptions_user (user_id)`, `idx_subscriptions_stripe (stripe_subscription_id)`

---

### `release_drafts`

Draft release notes (pro workflow).

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Draft ID |
| `org_id` | TEXT | Org scope (nullable for personal) |
| `user_id` | TEXT | FK → `users.id` — owner for access control |
| `project` | TEXT | Project name |
| `version` | TEXT | Target version |
| `status` | TEXT | `draft`, `submitted`, `approved`, `published` |
| `source_type` | TEXT | Data source used |
| `provider` | TEXT | AI provider |
| `model` | TEXT | AI model |
| `audience` | TEXT | Target audience |
| `tone` | TEXT | Writing tone |
| `notes_json` | JSONB | Structured release notes |
| `formatted_md` | TEXT | Markdown output |
| `formatted_html` | TEXT | HTML output |
| `raw_inputs_json` | JSONB | Raw input data (nullable) |
| `created_by` | TEXT | FK → `users.id` — author |
| `approved_by` | TEXT | Approver user ID (nullable) |
| `published_at` | TIMESTAMPTZ | Publication timestamp |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update |

Indexes: `idx_drafts_user (user_id, created_at DESC)`, `idx_drafts_org (org_id, created_at DESC)`

---

### `draft_revisions`

Revision history for drafts.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Revision ID |
| `draft_id` | TEXT | FK → `release_drafts.id` (CASCADE) |
| `revision_number` | INT | Sequential revision number |
| `notes_json` | JSONB | Snapshot of notes |
| `formatted_md` | TEXT | Markdown snapshot |
| `formatted_html` | TEXT | HTML snapshot |
| `changed_by` | TEXT | FK → `users.id` |
| `created_at` | TIMESTAMPTZ | Revision timestamp |

Index: `idx_revisions_draft (draft_id, revision_number)`

---

### `project_settings`

Saved per-project defaults (pro).

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Settings ID |
| `org_id` | TEXT | Org scope (nullable) |
| `user_id` | TEXT | FK → `users.id` |
| `project` | TEXT | Project name |
| `default_source` | TEXT | Default data source |
| `default_provider` | TEXT | Default AI provider |
| `default_model` | TEXT | Default model |
| `default_audience` | TEXT | Default audience |
| `default_tone` | TEXT | Default tone |
| `categories_json` | JSONB | Custom categories |
| `publish_targets_json` | JSONB | Publish targets |
| `widget_config_json` | JSONB | Widget configuration |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update |

Unique index: `idx_project_settings_owner (COALESCE(org_id, user_id), project)`

---

### `org_invites`

Pending org invitations.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Invite ID |
| `org_id` | TEXT | FK → `orgs.id` (CASCADE) |
| `email` | TEXT | Invitee email |
| `role` | TEXT | Granted role |
| `token` | TEXT UNIQUE | Invite token |
| `expires_at` | TIMESTAMPTZ | Expiry time |
| `accepted_at` | TIMESTAMPTZ | When accepted (nullable) |
| `created_by` | TEXT | FK → `users.id` |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

Indexes: `idx_invites_org (org_id)`, `idx_invites_token (token) WHERE accepted_at IS NULL`

---

### `revoked_tokens`

JWT token blacklist for logged-out / rotated tokens.

| Column | Type | Notes |
|--------|------|-------|
| `token_hash` | TEXT PK | SHA-256 hash of JWT |
| `user_id` | TEXT | User who revoked |
| `revoked_at` | TIMESTAMPTZ | Revocation time |
| `expires_at` | TIMESTAMPTZ | JWT natural expiry (auto-pruned) |

Auto-prune: expired entries deleted on startup.

---

### `webhook_events`

Stripe webhook idempotency table.

| Column | Type | Notes |
|--------|------|-------|
| `stripe_event_id` | TEXT PK | Stripe event ID |
| `event_type` | TEXT | Event type string |
| `processed_at` | TIMESTAMPTZ | Processing timestamp |

Auto-prune: events older than 30 days deleted on startup.

---

### `github_installations`

GitHub App installation tracking.

| Column | Type | Notes |
|--------|------|-------|
| `installation_id` | INT PK | GitHub installation ID |
| `user_id` | TEXT | FK → `users.id` (nullable until linked) |
| `github_login` | TEXT | GitHub account login |
| `repos` | JSONB | Array of repo full names |
| `created_at` | TIMESTAMPTZ | Installation timestamp |

Index: `idx_gh_install_user (user_id)`

---

### `team_api_keys`

Per-seat API keys for pro org plans.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Key ID |
| `org_id` | TEXT | FK → `orgs.id` (CASCADE) |
| `api_key` | TEXT UNIQUE | Plaintext key (nulled after hash backfill) |
| `api_key_hash` | TEXT | SHA-256 hash for lookups |
| `label` | TEXT | Human-readable label (e.g., "Seat 1") |
| `assigned_to_email` | TEXT | Assigned team member email (nullable) |
| `assigned_to_name` | TEXT | Assigned team member name (nullable) |
| `assigned_at` | TIMESTAMPTZ | When assigned (nullable) |
| `revoked_at` | TIMESTAMPTZ | When revoked (nullable — active if NULL) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

Index: `idx_team_keys_org (org_id) WHERE revoked_at IS NULL`

---

### `audit_events`

Audit trail for billing and admin actions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Event ID |
| `user_id` | TEXT | Acting user (nullable for system events) |
| `action` | TEXT | Event type (e.g., `team_key_provisioning_failed`) |
| `target` | TEXT | Target resource ID |
| `metadata` | JSONB | Additional context |
| `ip` | TEXT | Client IP address |
| `created_at` | TIMESTAMPTZ | Event timestamp |

Index: `idx_audit_events_user (user_id, created_at DESC)`
