# Cullit ⚡ — Platform Repository

> Cullit is now fully open source under MIT.
>
> This repository is the primary home for CLI, API server, GitHub App, and website/dashboard code.

[![npm version](https://img.shields.io/npm/v/cullit.svg)](https://www.npmjs.com/package/cullit)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](https://cullit.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ff69b4.svg)](https://github.com/sponsors/mttaylor)
[![GitHub stars](https://img.shields.io/github/stars/mttaylor/cullit?style=social)](https://github.com/mttaylor/cullit)

**Release notes automation that is fully free and community-supported.**

Cullit reads your git history, enriches from Jira and Linear, and generates categorized release notes for developers, customers, and executives. AI providers, integrations, dashboard workflows, and publishers are all available in the open-source codebase.

> Built by [Matt](https://cullit.io) — a solo developer. If Cullit saves you time, **[⭐ star the repo](https://github.com/mttaylor/cullit)** or support via **[GitHub Sponsors](https://github.com/sponsors/mttaylor)**, **[PayPal](https://paypal.me/mtaylorCE)**, **[Venmo](https://venmo.com/engineeringdad)**, **[Buy Me a Coffee](https://buymeacoffee.com/engineeringdad)**, or **[Ko-fi](https://ko-fi.com/mttaylor)** — it really helps keep the project alive.

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

- Public npm package `cullit`: full CLI with template and AI provider support
- Monorepo packages: core engine, API server, GitHub App, website/dashboard
- Community funding: GitHub Sponsors, PayPal, Venmo, Buy Me a Coffee, and Ko-fi support maintenance and roadmap work

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

## Support Cullit

```bash
# Run AI generation with your own provider key
cullit generate --from v1.0.0 --to v1.1.0 --provider anthropic
```

If Cullit is useful to your team, support the project through one of these options:

- GitHub Sponsors: https://github.com/sponsors/mttaylor
- PayPal: https://paypal.me/mtaylorCE
- Venmo: https://venmo.com/engineeringdad
- Buy Me a Coffee: https://buymeacoffee.com/engineeringdad
- Ko-fi: https://ko-fi.com/mttaylor

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
| `--source` | string | `local` | Data source: `local`, `jira`, `linear`, `gitlab` (CLI-only), `bitbucket` (CLI-only), `multi-repo` |
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

      - uses: mttaylor/cullit@v2
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
| 🔑 **BYOK AI** | Use your own provider keys with no paid tier requirement |
| ⚡ **Flexible Sources** | Git, Jira, Linear, GitLab, or Bitbucket as primary data source |
| 🔍 **Enrichment** | Cross-reference Jira & Linear tickets from commits |
| 📤 **Multi-Publish** | Slack, Discord, Teams, GitHub Release, GitLab Release, Hosted Changelog, Embed Widget, Confluence, Notion, file, stdout |
| 🎯 **Audience Modes** | Developer, end-user, or executive summaries |
| 📋 **Smart Categories** | Features, fixes, breaking changes, improvements, chores |
| 🔇 **Structured Logging** | `--verbose` and `--quiet` flags for CI-friendly output |
| 🐳 **Docker Ready** | Multi-stage build, docker-compose for API & CLI |
| 🌐 **REST API** | OpenAPI 3.1 spec, health checks, CORS |
| 🔒 **Enterprise** | SECURITY.md, PRIVACY.md, TERMS.md, CODE_OF_CONDUCT.md |

## Packages

| Package | Description |
|---------|-------------|
| [`cullit`](https://www.npmjs.com/package/cullit) | CLI installer with full release-note generation workflows |
| `@cullit/licensed` | Backward-compat helper package retained during OSS transition |
| [`@cullit/core`](https://www.npmjs.com/package/@cullit/core) | Core engine — pipeline, generators, publishers |
| [`@cullit/config`](https://www.npmjs.com/package/@cullit/config) | Config loader — YAML parsing with env var resolution |
| `@cullit/api` | REST API server — OpenAPI 3.1, rate limiting, pipeline cache |
| `@cullit/app` | GitHub App — auto-generate release notes on tag push or release publish |

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
| `RESEND_API_KEY` | Transactional email delivery |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (status, version, uptime) |
| `GET` | `/openapi.json` | OpenAPI 3.1 specification |
| `POST` | `/generate` | Generate release notes |
| `POST` | `/v1/generate` | Generate notes with API/server-side defaults |
| `GET` | `/auth/me` | Current authenticated dashboard user |
| `POST` | `/auth/logout` | End dashboard session |
| `GET` | `/v1/history` | Paginated generation history |
| `GET` | `/v1/analytics/usage` | Usage analytics and provider breakdown |
| `POST` | `/v1/drafts` | Create draft |
| `GET` | `/v1/drafts` | List drafts |
| `GET` | `/v1/drafts/:id` | Draft details with revisions |
| `PATCH` | `/v1/drafts/:id` | Update draft |
| `DELETE` | `/v1/drafts/:id` | Delete draft |
| `POST` | `/v1/drafts/:id/submit` | Submit draft for review |
| `POST` | `/v1/drafts/:id/approve` | Approve draft (owner/admin) |
| `POST` | `/v1/drafts/:id/publish` | Publish draft to changelog |
| `GET` | `/v1/projects/settings` | List saved project defaults |
| `PUT` | `/v1/projects/:project/settings` | Save project defaults |
| `GET` | `/v1/github/installations` | List linked GitHub App installations |
| `POST` | `/v1/github/disconnect` | Disconnect a GitHub App installation |
| `GET` | `/v1/org` | Get current organization |
| `POST` | `/v1/org` | Create an organization (open to any authenticated user) |
| `PATCH` | `/v1/org/settings` | Update organization settings |
| `POST` | `/v1/org/invites` | Create org invite by email |
| `GET` | `/v1/org/invites` | List pending org invites |
| `DELETE` | `/v1/org/invites/:id` | Revoke pending org invite |
| `PATCH` | `/v1/org/members/:userId` | Update org member role |
| `GET` | `/v1/org/usage` | Team usage summary |
| `GET` | `/v1/org/keys` | List team API keys |
| `PATCH` | `/v1/org/keys/:id` | Update team key label/assignment |
| `POST` | `/v1/org/keys/:id/send` | Email key to assigned member |
| `POST` | `/v1/org/keys/:id/revoke` | Revoke a team key |
| `POST` | `/v1/org/keys/:id/rotate` | Rotate a team key |

## Dashboard & Tutorials

Cullit includes a hosted dashboard experience with authentication, analytics, and team workflows:

- Dashboard: `site/dashboard.html`
- Docs: `site/docs.html`
- Interactive tutorial: `site/tutorial.html`
- Setup guide: `site/setup.html`
- Support: `site/pricing.html`

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

### AI provider key not recognized

- Ensure you set the key matching your selected provider (for example `ANTHROPIC_API_KEY` for `--provider anthropic`)
- Check for trailing whitespace in the secret value
- In GitHub Actions, set provider keys as repository secrets and expose them in `env`

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

## Support the project

Cullit is built and maintained by **one developer** in their spare time. If it helps you ship better release notes faster:

- ⭐ **[Star on GitHub](https://github.com/mttaylor/cullit)** — costs nothing, helps massively with discovery
- ❤️ **[Sponsor on GitHub](https://github.com/sponsors/mttaylor)** — recurring support, even $5/mo keeps the lights on
- ☕ **[Buy a coffee](https://cullit.io/sponsor)** — one-time tip
- 🐦 Tell other devs about it — word of mouth is everything for indie tools
- 🛠️ Open issues and PRs — code, docs, tests, and review help all move the project forward

Every star, sponsor, and shoutout is genuinely appreciated.

## License

Cullit is MIT licensed across this repository:

| Component | Package(s) | License |
|---|---|---|
| **Engine** — pipeline, git collector, formatter | `@cullit/core`, `@cullit/config` | [MIT](LICENSE) |
| **CLI** — `cullit generate`, `cullit verify` | `@cullit/cli` (npm: `cullit`) | [MIT](LICENSE) |
| **AI providers + integrations** — OpenAI, Anthropic, Gemini, Ollama, Linear, Jira | `@cullit/pro` | [MIT](LICENSE) |
| **License helper** | `@cullit/licensed` | [MIT](LICENSE) |
| **GitHub Action** | `action.yml` | [MIT](LICENSE) |
| **Hosted API server** | `packages/api` | [MIT](LICENSE) |
| **GitHub App webhook server** | `packages/app` | [MIT](LICENSE) |
| **Dashboard + landing page** | `site/` | [MIT](LICENSE) |

Everything needed for local and hosted workflows is open source and available for community use and contribution.

See also: [TERMS.md](TERMS.md) • [CONTRIBUTING.md](CONTRIBUTING.md)

---

Built by [Matt](https://cullit.io) • [GitHub](https://github.com/mttaylor/cullit)
