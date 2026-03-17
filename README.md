# Cullit ⚡

[![npm version](https://img.shields.io/npm/v/cullit.svg)](https://www.npmjs.com/package/cullit)
[![CI](https://github.com/mttaylor/cullit/actions/workflows/ci.yml/badge.svg)](https://github.com/mttaylor/cullit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**AI release notes that write themselves.**

Cullit reads your git history, enriches from Jira & Linear, and uses AI to generate categorized, human-readable release notes. Ships to Slack, Discord, Teams, GitHub & GitLab Releases, Confluence, Notion, and more.

> Built by [Matt](https://cullit.io).

---

## Install

```bash
# Use directly with npx (no install needed)
npx cullit generate --from v1.0.0 --to v1.1.0

# Or install globally
npm install -g cullit

# Or as a dev dependency
npm install -D cullit
```

## Quick Start

```bash
# Interactive setup — creates .cullit.yml
cullit init

# Generate release notes between two tags
cullit generate --from v1.0.0 --to v1.1.0

# Auto-detect latest two tags
cullit generate

# Different AI providers
cullit generate --from HEAD~10 --provider gemini
cullit generate --from HEAD~5 --provider ollama --model llama3.1

# No AI key? Use the template generator
cullit generate --from HEAD~10 --provider none

# From Jira or Linear
cullit generate --source jira --from "project = PROJ" --provider anthropic
cullit generate --source linear --from "team:ENG" --provider openai

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
| 🔑 **BYOK** | Bring your own API key. Zero vendor lock-in. |
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
| [`cullit`](https://www.npmjs.com/package/cullit) | CLI — `npx cullit generate` |
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
  # - type: discord
  #   webhook_url: $DISCORD_WEBHOOK_URL
  # - type: teams
  #   webhook_url: $TEAMS_WEBHOOK_URL
  # - type: confluence
  # - type: notion
  # - type: gitlab-release
  # - type: changelog

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

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (status, version, uptime) |
| `GET` | `/openapi.json` | OpenAPI 3.1 specification |
| `POST` | `/generate` | Generate release notes |

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

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT — see [LICENSE](LICENSE)

---

Built by [Matt](https://cullit.io) • [GitHub](https://github.com/mttaylor/cullit)
