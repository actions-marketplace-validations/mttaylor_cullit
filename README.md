# Cullit ⚡

[![npm version](https://img.shields.io/npm/v/cullit.svg)](https://www.npmjs.com/package/cullit)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](https://cullit.io)
[![License](https://img.shields.io/badge/License-Proprietary-blue.svg)](LICENSE)

**Release notes that scale from a free local CLI to licensed hosted workflows.**

Cullit reads your git history, enriches from Jira & Linear, and can generate categorized release notes for developers, customers, and executives. The public npm package is the free local/template CLI. AI providers, premium integrations, dashboard workflows, and private deployment surfaces are licensed separately.

> Built by [Matt](https://cullit.io).

---

## Install

```bash
# Use the public CLI directly with npx
npx cullit generate --from v1.0.0 --to v1.1.0 --provider none

# Or install globally for local/template workflows
npm install -g cullit

# Or as a dev dependency
npm install -D cullit
```

## Distribution Model

- Public npm package `cullit`: local git, template generation with `--provider none`, stdout/file output
- Private registry package `@cullit/licensed`: paid tiers (Pro, Team 5/10/25, Enterprise) with AI providers, Jira/Linear enrichment, premium publishers, dashboard, API, GitHub App, and private deployment flows
- npm is the delivery channel for the CLI runtime, not the paid entitlement layer

## Quick Start

```bash
# Interactive setup — creates .cullit.yml
cullit init

# Generate release notes between two tags
cullit generate --from v1.0.0 --to v1.1.0 --provider none

# Auto-detect latest two tags
cullit generate --provider none

# Use the built-in template generator
cullit generate --from HEAD~10 --provider none

# Apply a named template profile from config
cullit generate --from v1.8.0 --template customer-facing

# Control output verbosity
cullit generate --from v1.0.0 --verbose
cullit generate --from v1.0.0 --quiet
```

## Paid Upgrade In Under 10 Minutes

```bash
# 1) Install paid distribution from your private registry
npm install -g @cullit/licensed

# 2) Set your Cullit license key
export CULLIT_API_KEY=clt_your_key_here

# 3) Run your first AI generation
cullit generate --from v1.0.0 --to v1.1.0 --provider anthropic
```

If you do not have a paid key yet, start at https://cullit.io/pricing.

## CLI Command Reference

### `cullit init`

Interactive setup wizard — creates a `.cullit.yml` configuration file.

```bash
cullit init
```

### `cullit generate`

Generate release notes from your configured source and provider.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--from` | string | Auto-detect | Start ref (tag, SHA, `HEAD~N`, JQL query, or Linear filter) |
| `--to` | string | `HEAD` | End ref |
| `--provider` | string | From config | AI provider: `anthropic`, `openai`, `gemini`, `ollama`, `none` |
| `--model` | string | Provider default | Override the AI model (e.g., `claude-sonnet-4-6-20250514`) |
| `--audience` | string | `developer` | Target audience: `developer`, `end-user`, `executive` |
| `--tone` | string | `professional` | Writing tone: `professional`, `casual`, `terse`, `edgy`, `hype`, `snarky` |
| `--format` | string | `markdown` | Output format: `markdown`, `html`, `html-dark`, `html-minimal`, `html-edgy`, `json` |
| `--template` | string | — | Named template profile from `.cullit.yml` |
| `--source` | string | `local` | Data source: `local`, `jira`, `linear`, `gitlab`, `bitbucket`, `multi-repo` |
| `--dry-run` | boolean | `false` | Generate but don't publish; output to stdout |
| `--verbose` | boolean | `false` | Show detailed progress and debug info |
| `--quiet` | boolean | `false` | Suppress all output except the result |

**Examples:**

```bash
# Auto-detect latest two tags, template mode
cullit generate --provider none

# Between specific tags with AI
cullit generate --from v1.0.0 --to v1.1.0 --provider anthropic

# Executive summary from last 20 commits
cullit generate --from HEAD~20 --audience executive --tone terse

# HTML output for customer-facing notes
cullit generate --from v2.0.0 --format html --template customer-facing

# Jira as primary source
cullit generate --from "project = PROJ AND fixVersion = 1.5" --source jira

# Dry-run (no publishing)
cullit generate --from v1.0.0 --dry-run --verbose
```

### `cullit --version`

Print the installed Cullit version.

```bash
cullit --version
```

## Multi-Repo Aggregation

Merge commits from multiple repositories into a single changelog. Add a `repos` array to `.cullit.yml`:

```yaml
source:
  type: multi-repo

repos:
  - path: ../api-service
    name: api
  - path: ../web-app
    name: web
  - url: https://github.com/acme/shared-lib.git
    name: shared
    from: v2.0.0   # optional per-repo override
    to: v2.1.0
```

Or run directly:

```bash
cullit generate --source multi-repo
```

## GitHub App

Install from the GitHub Marketplace for zero-config release notes. The app auto-generates notes when you:

- **Push a tag** — creates a GitHub Release with AI-generated notes
- **Publish a release** — enriches the release body with categorized notes

Self-host with Docker:

```bash
docker run -p 3001:3001 \
  -e GITHUB_APP_ID=12345 \
  -e GITHUB_APP_PRIVATE_KEY="$(base64 < private-key.pem)" \
  -e GITHUB_WEBHOOK_SECRET=your-secret \
  cullit/app
```

## Use as a Library

```typescript
import { runPipeline, createLogger } from '@cullit/core';
import { loadConfig } from '@cullit/config';

const config = loadConfig();
const logger = createLogger('verbose'); // 'quiet' | 'normal' | 'verbose'

const result = await runPipeline('v1.0.0', 'v1.1.0', config, {
  format: 'markdown',
  dryRun: false,
  logger,
});

console.log(result.formatted);
console.log(`Published to: ${result.publishedTo.join(', ')}`);
```

## GitHub Action

```yaml
name: Release Notes
on:
  push:
    tags: ['v*']

jobs:
  release-notes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0  # Full history needed for git log

      - uses: mttaylor/cullit@v1
        with:
          provider: anthropic
          audience: developer
          publish-github-release: 'true'
          publish-slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
          # publish-teams-webhook: ${{ secrets.TEAMS_WEBHOOK }}
          # publish-confluence: 'true'
          # publish-notion: 'true'
          # publish-gitlab-release: 'true'
          # publish-changelog: 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## API Server

```bash
# Start the API server
PORT=3000 node packages/api/dist/index.js

# Or with Docker
docker compose up api
```

```bash
# Generate release notes via API
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{"from": "v1.0.0", "to": "v1.1.0", "provider": "anthropic"}'

# OpenAPI spec
curl http://localhost:3000/openapi.json
```

Production hardening defaults:

- `ALLOWED_ORIGINS` should be set to your exact frontend origin(s)
- `RATE_LIMIT` defaults to `30` requests/minute per IP
- `/v1/events` accepts funnel events (`checkout_started`, `first_generate_success`, etc.) for launch conversion tracking

> **Note:** Without `DATABASE_URL`, the API uses file-backed JSON stores that are ephemeral on container restart. Rate limiting and caching are in-memory per-process only — not shared across instances. For production, set `DATABASE_URL` to a PostgreSQL connection string.

## Docker

```bash
# Build
docker build -t cullit .

# CLI mode
docker run --env-file .env cullit generate --from v1.0.0 --to v1.1.0

# API server mode
docker compose up api
```

## Features

| Feature | Description |
|---------|-------------|
| 🧠 **4 AI Providers + Template** | Anthropic Claude, OpenAI, Gemini, Ollama, or none (template) |
| 🔑 **Licensed AI** | Paid AI and premium integrations are available through licensed hosted/private Cullit surfaces. |
| ⚡ **Flexible Sources** | Git, Jira, Linear, GitLab, or Bitbucket as primary data source |
| 🔍 **Enrichment** | Cross-reference Jira & Linear tickets from commits |
| 📤 **Multi-Publish** | Slack, Discord, Teams, GitHub Release, GitLab Release, Confluence, Notion, Hosted Changelog, Embed Widget, file, stdout |
| 🎯 **Audience Modes** | Developer, end-user, or executive summaries |
| 📋 **Smart Categories** | Features, fixes, breaking changes, improvements, chores |
| 🔇 **Structured Logging** | `--verbose` and `--quiet` flags for CI-friendly output |
| 🐳 **Docker Ready** | Multi-stage build, docker-compose for API & CLI |
| 🌐 **REST API** | OpenAPI 3.1 spec, health checks, CORS |
| 🔒 **Enterprise** | SECURITY.md, PRIVACY.md, TERMS.md, CODE_OF_CONDUCT.md |

## Packages

| Package | Description |
|---------|-------------|
| [`cullit`](https://www.npmjs.com/package/cullit) | Public CLI installer — local/template workflow with `--provider none` |
| `@cullit/licensed` | Private registry package for paid tiers (Pro, Team, Enterprise) |
| [`@cullit/core`](https://www.npmjs.com/package/@cullit/core) | Core engine — pipeline, generators, publishers |
| [`@cullit/config`](https://www.npmjs.com/package/@cullit/config) | Config loader — YAML parsing with env var resolution |
| `@cullit/api` | REST API server (private) — OpenAPI 3.1, rate limiting, pipeline cache |
| `@cullit/app` | GitHub App (private) — auto-generate release notes on tag push or release publish |

## Configuration

Create `.cullit.yml` in your repo root (or run `cullit init`):

```yaml
ai:
  provider: anthropic         # anthropic | openai | gemini | ollama | none
  audience: developer
  tone: professional
  categories: [features, fixes, breaking, improvements, chores]

source:
  type: local                 # local | jira | linear | gitlab | bitbucket | multi-repo
  enrichment: [jira]

publish:
  - type: stdout
  - type: github-release
  - type: slack
    webhook_url: $SLACK_WEBHOOK_URL
  - type: confluence
    format: html
    template_profile: customer-facing
  - type: teams
    webhook_url: $TEAMS_WEBHOOK_URL
    format: html-dark
  # - type: discord
  #   webhook_url: $DISCORD_WEBHOOK_URL
  # - type: notion
  # - type: gitlab-release
  # - type: changelog

template:
  default: customer-facing
  section_order: [features, improvements, fixes, breaking, chores, other]
  include_metadata: false

templates:
  - name: customer-facing
    format: html-minimal
    section_order: [features, improvements, fixes, breaking, chores, other]
    include_contributors: false
    summary_prefix: "Customer-facing summary:"

jira:
  domain: yourcompany.atlassian.net

# gitlab:
#   projectId: "12345"
# bitbucket:
#   workspace: your-workspace
#   repoSlug: your-repo
# confluence:
#   domain: yourcompany.atlassian.net
#   spaceKey: ENG
# notion:
#   databaseId: your-database-id

# Multi-repo aggregation (use with source.type: multi-repo)
# repos:
#   - path: ../api-service
#     name: api
#   - url: https://github.com/acme/shared-lib.git
#     name: shared
```

### Environment Variables

| Variable | Required For |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic/Claude |
| `OPENAI_API_KEY` | OpenAI |
| `GOOGLE_API_KEY` | Google Gemini |
| `OLLAMA_HOST` | Ollama (defaults to localhost:11434) |
| `JIRA_EMAIL` | Jira enrichment |
| `JIRA_API_TOKEN` | Jira enrichment |
| `LINEAR_API_KEY` | Linear enrichment |
| `GITHUB_TOKEN` | GitHub Release publishing |
| `SLACK_WEBHOOK_URL` | Slack publishing |
| `DISCORD_WEBHOOK_URL` | Discord publishing |
| `TEAMS_WEBHOOK_URL` | Teams publishing |
| `GITLAB_TOKEN` | GitLab collector & release publishing |
| `GITLAB_PROJECT_ID` | GitLab project (numeric ID or URL-encoded path) |
| `BITBUCKET_USERNAME` | Bitbucket collector |
| `BITBUCKET_APP_PASSWORD` | Bitbucket collector |
| `CONFLUENCE_EMAIL` | Confluence publishing |
| `CONFLUENCE_API_TOKEN` | Confluence publishing |
| `NOTION_API_KEY` | Notion publishing |
| `GITHUB_APP_ID` | GitHub App |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App (base64 PEM or raw) |
| `GITHUB_WEBHOOK_SECRET` | GitHub App webhook verification |
| `CULLIT_APP_PORT` | GitHub App server port (default: 3001) |
| `CULLIT_API_TOKEN` | Optional bearer token for API auth |
| `ALLOWED_ORIGINS` | API CORS allowlist |
| `DATABASE_URL` | Enable PostgreSQL mode for API/dashboard |
| `REDIS_URL` | Redis URL for shared rate limiting across instances |
| `WORKOS_CLIENT_ID` | Dashboard login (WorkOS AuthKit) |
| `WORKOS_API_KEY` | Dashboard login (WorkOS API key) |
| `CULLIT_JWT_SECRET` | Dashboard session signing secret |
| `CULLIT_BASE_URL` | Public base URL for OAuth callbacks |
| `STRIPE_SECRET_KEY` | Stripe billing API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `STRIPE_PRO_PRICE_ID` | Stripe price id for Pro plan |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | Stripe price id for Pro annual plan (15% off) |
| `STRIPE_TEAM_PRICE_ID` | Per-seat price id for Team plan ($8/seat/mo, min 5 seats) |
| `STRIPE_TEAM_ANNUAL_PRICE_ID` | Per-seat price id for Team annual ($81.60/seat/yr — 15% off) |
| `RESEND_API_KEY` | Transactional email delivery |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (status, version, uptime) |
| `GET` | `/openapi.json` | OpenAPI 3.1 specification |
| `POST` | `/generate` | Generate release notes |
| `POST` | `/v1/generate` | Generate notes with usage and tier enforcement |
| `GET` | `/auth/me` | Current authenticated dashboard user |
| `POST` | `/auth/logout` | End dashboard session |
| `GET` | `/v1/history` | Paginated generation history |
| `GET` | `/v1/analytics/usage` | Usage analytics and provider breakdown |
| `POST` | `/v1/drafts` | Create draft (Team+) |
| `GET` | `/v1/drafts` | List drafts (Team+) |
| `GET` | `/v1/drafts/:id` | Draft details with revisions |
| `PATCH` | `/v1/drafts/:id` | Update draft |
| `DELETE` | `/v1/drafts/:id` | Delete draft |
| `POST` | `/v1/drafts/:id/submit` | Submit draft for review |
| `POST` | `/v1/drafts/:id/approve` | Approve draft (owner/admin) |
| `POST` | `/v1/drafts/:id/publish` | Publish draft to changelog |
| `GET` | `/v1/projects/settings` | List saved project defaults |
| `PUT` | `/v1/projects/:project/settings` | Save project defaults |
| `POST` | `/v1/org/invites` | Create org invite by email |
| `GET` | `/v1/org/invites` | List pending org invites |
| `DELETE` | `/v1/org/invites/:id` | Revoke pending org invite |
| `PATCH` | `/v1/org/members/:userId` | Update org member role |
| `GET` | `/v1/org/usage` | Team usage and seat summary |
| `GET` | `/v1/org/keys` | List team API keys |
| `PATCH` | `/v1/org/keys/:id` | Update team key label/assignment |
| `POST` | `/v1/org/keys/:id/send` | Email key to assigned member |
| `POST` | `/v1/org/keys/:id/revoke` | Revoke a team key |
| `POST` | `/v1/org/keys/:id/rotate` | Rotate a team key |

## Dashboard & Tutorials

Cullit includes a hosted dashboard experience with authentication, billing, analytics, and team workflows:

- Dashboard: `site/dashboard.html`
- Docs: `site/docs.html`
- Interactive tutorial: `site/tutorial.html`
- Setup guide: `site/setup.html`
- Pricing: `site/pricing.html`

## Roadmap

- [x] Core CLI with interactive init
- [x] Claude, OpenAI, Gemini, Ollama + template generator
- [x] Jira & Linear as primary sources
- [x] Jira & Linear enrichment (batched)
- [x] Slack, Discord, GitHub Release publishers
- [x] REST API with OpenAPI 3.1
- [x] Docker & docker-compose
- [x] GitHub Action (node22)
- [x] Structured logging (--verbose / --quiet)
- [x] 200+ unit tests + integration tests
- [x] Microsoft Teams publisher
- [x] Confluence publisher
- [x] Notion publisher
- [x] GitLab collector & release publisher
- [x] Bitbucket collector
- [x] Hosted changelog pages
- [x] Embeddable changelog widget
- [x] GitHub App (Marketplace)
- [x] Web dashboard
- [x] Multi-repo aggregation

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Troubleshooting

### `CULLIT_API_KEY` not recognized

- Ensure the key starts with `clt_` and is at least 32 characters
- Check for trailing whitespace: `echo -n "$CULLIT_API_KEY" | wc -c`
- In GitHub Actions, set it as a repository secret and reference with `${{ secrets.CULLIT_API_KEY }}`

### `provider none` produces limited output

The `none` provider uses a built-in template engine that groups commits by category. For AI-synthesized notes, use `--provider anthropic` (or `openai`, `gemini`, `ollama`) with the corresponding API key set.

### API returns 429 Too Many Requests

Default rate limit is 30 requests/minute per IP. Increase with `RATE_LIMIT=100` environment variable. For multi-instance deployments, set `REDIS_URL` to share rate limit state across processes.

### Dashboard login fails

- Verify `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` are set
- Check that `CULLIT_BASE_URL` matches the URL your users access (including port)
- OAuth callback URL in WorkOS must match `{CULLIT_BASE_URL}/auth/callback`

### Database features are disabled

Set `DATABASE_URL` to a PostgreSQL connection string. Without it, the API uses ephemeral file-backed stores. Migrations run automatically on startup.

### Docker build fails

- Ensure `pnpm-lock.yaml` exists (run `pnpm install` first)
- The Dockerfile expects Node.js 22+. Check your base image.
- For monorepo issues, ensure all workspace packages are present

### GitHub App not generating release notes

- Confirm the app is installed on the target repository
- Check that `GITHUB_APP_PRIVATE_KEY` is base64-encoded or raw PEM
- Verify `GITHUB_WEBHOOK_SECRET` matches the value in GitHub App settings
- Check the Settings tab in the dashboard to see linked installations

### Generation returns empty or no changes

- Ensure `--from` and `--to` refs exist: `git tag -l` or `git log --oneline`
- Use `--verbose` to see which commits are being processed
- For Jira/Linear sources, verify the API token and query syntax

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Legal

- [PRIVACY.md](PRIVACY.md)
- [TERMS.md](TERMS.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

Proprietary — see [LICENSE](LICENSE) and [TERMS.md](TERMS.md)

---

Built by [Matt](https://cullit.io) • [GitHub](https://github.com/mttaylor/cullit)
