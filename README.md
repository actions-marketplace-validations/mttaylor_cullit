# Cullit ⚡

**AI release notes that write themselves.**

Cullit reads your git history, enriches from Jira & Linear, and uses AI to generate categorized, human-readable release notes. Ships to Slack, Discord, GitHub Releases, and more.

> A [Deploy or Die](https://deployordie.io) product.

---

## Quick Start

### CLI

```bash
# Install
npm install -g cullit

# Initialize config
cullit init

# Generate release notes between two tags
cullit generate --from v1.0.0 --to v1.1.0

# Auto-detect latest two tags
cullit generate

# Different AI providers
cullit generate --from HEAD~10 --provider gemini
cullit generate --from HEAD~5 --provider ollama --model llama3.1

# From Jira or Linear
cullit generate --source jira --from "project = PROJ" --provider anthropic
cullit generate --source linear --from "team:ENG" --provider openai
```

### GitHub Action

```yaml
name: Release Notes
on:
  push:
    tags: ['v*']

jobs:
  release-notes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history needed for git log

      - uses: deployordie/cullit@v1
        with:
          provider: anthropic
          audience: developer
          publish-github-release: 'true'
          publish-slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### API Server

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

### Docker

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
| 🧠 **5 AI Providers** | Anthropic Claude, OpenAI, Gemini, Ollama, OpenClaw |
| 🔑 **BYOK** | Bring your own API key. Zero vendor lock-in. |
| ⚡ **Flexible Sources** | Git, Jira, or Linear as primary data source |
| 🔍 **Enrichment** | Cross-reference Jira & Linear tickets from commits |
| 📤 **Multi-Publish** | Slack, Discord, GitHub Release, file, stdout |
| 🎯 **Audience Modes** | Developer, end-user, or executive summaries |
| 📋 **Smart Categories** | Features, fixes, breaking changes, improvements, chores |
| 🐳 **Docker Ready** | Multi-stage build, docker-compose for API & CLI |
| 🌐 **REST API** | OpenAPI 3.1 spec, health checks, CORS |
| 🔒 **Enterprise** | SECURITY.md, PRIVACY.md, TERMS.md, CODE_OF_CONDUCT.md |

## Configuration

Create `.cullit.yml` in your repo root (or run `cullit init`):

```yaml
ai:
  provider: anthropic         # anthropic | openai | gemini | ollama | openclaw
  audience: developer
  tone: professional
  categories: [features, fixes, breaking, improvements, chores]

source:
  type: local                 # local | jira | linear
  enrichment: [jira]

publish:
  - type: stdout
  - type: github-release
  - type: slack
    webhook_url: $SLACK_WEBHOOK_URL

jira:
  domain: yourcompany.atlassian.net
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

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (status, version, uptime) |
| `GET` | `/openapi.json` | OpenAPI 3.1 specification |
| `POST` | `/generate` | Generate release notes |

## Roadmap

- [x] Core CLI
- [x] Claude, OpenAI, Gemini, Ollama, OpenClaw
- [x] Jira & Linear as primary sources
- [x] Jira & Linear enrichment
- [x] Slack, Discord, GitHub Release publishers
- [x] REST API with OpenAPI 3.1
- [x] Docker & docker-compose
- [x] GitHub Action with sample workflow
- [x] Test infrastructure
- [ ] Confluence publisher
- [ ] Notion publisher
- [ ] GitLab & Bitbucket support
- [ ] Hosted changelog pages
- [ ] Web dashboard

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT — see [LICENSE](LICENSE)

---

Built by [Matt](https://deployordie.io) • [Newsletter](https://deployordie.io) • [YouTube](https://youtube.com/@deployordie)
