# Cullit ⚡

[![npm version](https://img.shields.io/npm/v/cullit.svg)](https://www.npmjs.com/package/cullit)
[![CI](https://github.com/mttaylor/cullit/actions/workflows/ci.yml/badge.svg)](https://github.com/mttaylor/cullit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
- Private registry package `@cullit/licensed`: paid tiers (Pro, Team, Enterprise) with AI providers, Jira/Linear enrichment, premium publishers, dashboard, API, GitHub App, and private deployment flows
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
| 🧠 **6 AI Providers** | Anthropic Claude, OpenAI, Gemini, Ollama, OpenClaw, or none (template) |
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
| `@cullit/pro` | Pro integrations (private) — GitLab, Bitbucket, Teams, Confluence, Notion, AI generators |
| `@cullit/api` | REST API server (private) — OpenAPI 3.1, rate limiting, pipeline cache |
| `@cullit/app` | GitHub App (private) — auto-generate release notes on tag push or release publish |

## Configuration

Create `.cullit.yml` in your repo root (or run `cullit init`):

```yaml
ai:
  provider: anthropic         # anthropic | openai | gemini | ollama | openclaw | none
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
| `OPENCLAW_URL` | OpenClaw gateway |
| `OPENCLAW_TOKEN` | OpenClaw auth |
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
| `GITHUB_CLIENT_ID` | Dashboard GitHub OAuth client id |
| `GITHUB_CLIENT_SECRET` | Dashboard GitHub OAuth secret |
| `CULLIT_JWT_SECRET` | Dashboard session signing secret |
| `CULLIT_BASE_URL` | Public base URL for OAuth callbacks |
| `CULLIT_TRIAL_DAYS` | Trial duration override (default 14) |
| `STRIPE_SECRET_KEY` | Stripe billing API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `STRIPE_PRICE_PRO_MONTHLY` | Stripe price id for Pro plan |
| `STRIPE_PRICE_TEAM_MONTHLY` | Stripe price id for Team plan |
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

## Dashboard & Tutorials

Cullit includes a hosted dashboard experience with authentication, billing, trial handling, analytics, and team workflows:

- Dashboard: `site/dashboard.html`
- Docs: `site/docs.html`
- Interactive tutorial: `site/tutorial.html`
- Setup guide: `site/setup.html`
- Pricing: `site/pricing.html`

## Roadmap

- [x] Core CLI with interactive init
- [x] Claude, OpenAI, Gemini, Ollama, OpenClaw + template generator
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

## Release Notes

### v1.9.2

**Integrity, Build, and Release Hardening**

- **🛡️ Release workflow integrity**: Reordered tag-based publishing so package versions are updated before build and test steps run, preventing stale version metadata from leaking into published artifacts.

- **🔁 Action bundle drift protection**: Added a CI guard that rebuilds the GitHub Action and fails if [dist/action.js](dist/action.js) is out of sync with [src/action.ts](src/action.ts), so reviewed source and shipped action stay aligned.

- **⚙️ GitHub Action consistency**: Aligned the Action input defaults with runtime behavior by defaulting the provider to `none`, matching the free-first template flow documented elsewhere in the product.

- **🏗️ Action build reliability**: Fixed the Action bundle path by removing top-level await from the entrypoint, loading Pro plugins lazily, and wiring root workspace dependencies so `pnpm build:action` succeeds consistently in CI and local builds.

- **📱 Free trial mobile navigation fix**: Reworked the standalone free-trial page so mobile navigation and the docs sidebar use separate controls, eliminating the broken shared-toggle behavior.

- **🔒 Safer markdown output**: Hardened markdown rendering to escape raw HTML while preserving readable Markdown output, reducing integrity risk when notes are rendered downstream by external consumers.

- **📦 Packaging hygiene**: Added an explicit publish whitelist to the Pro package and rebuilt the committed GitHub Action bundle as part of the normal build path.

### v1.9.0

**Template Profiles & Target-Specific Layouts**

- **🎨 Named Template Profiles**: Define reusable layout profiles in `.cullit.yml` with `template.default` and `templates[]` for different audiences (e.g., `customer-facing`, `internal`, `executive`).
  ```yaml
  template:
    default: customer-facing
    templates:
      - name: customer-facing
        format: markdown
        sectionOrder: [features, fixes, breaking-changes]
        includeContributors: false
        summaryPrefix: "**What's New** — "
  ```

- **📍 Per-Destination Overrides**: Use `publish[].templateProfile`, `publish[].format`, and `publish[].sectionOrder` to customize what each channel (Slack, Confluence, GitHub, etc.) receives without managing separate configs.

- **⚙️ CLI Profile Selection**: Run `cullit generate --template customer-facing` to apply a named profile, with fallback to config defaults.

- **🎛️ Dashboard Template Settings**: Extended project settings UI with template profile selector, format picker, section ordering, and JSON publish-target override textarea for webhook targets.

- **🔌 API Template Payload Support**: Enhanced `/v1/projects/:project/settings` endpoint to accept and merge template configuration into widget settings, enabling programmatic template management.

- **✅ Zero-Config Defaults**: Template profiles are optional; generation works without config. Profiles layer on top of global format/audience settings for fine-grained control.

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Legal

- [PRIVACY.md](PRIVACY.md)
- [TERMS.md](TERMS.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

MIT — see [LICENSE](LICENSE)

---

Built by [Matt](https://cullit.io) • [GitHub](https://github.com/mttaylor/cullit)
