# Cullit — GitHub App

> Auto-generate AI-powered release notes when you push a tag or publish a release. Zero config.

## How It Works

1. **Install** the Cullit App on your repository
2. **Push a tag** or **publish a GitHub Release**
3. Cullit automatically generates release notes and creates/updates your GitHub Release

That's it. No CI config, no YAML, no manual steps.

## What You Get

Beautiful, categorized release notes generated from your commit history:

```
## Release v2.4.0 — March 15, 2026

This release introduces real-time collaboration, new export formats,
and several performance improvements.

✨ Features
- Real-time collaboration for shared dashboards
- Export API now supports CSV and PDF formats

🐛 Bug Fixes
- Fixed timezone rendering in scheduled reports
- Resolved memory leak in WebSocket pool

⚠️ Breaking Changes
- /api/v1/export deprecated, use /api/v2/export
```

## Features

- **Zero configuration** — works immediately after install
- **Smart categorization** — features, fixes, breaking changes, improvements
- **Tag push + Release publish** — triggers on both events
- **Installation tracking** — see which repos are connected
- **Lightweight** — generates notes in seconds
- **Self-hostable** — run your own instance with Docker

## Permissions

| Permission | Access | Why |
|---|---|---|
| Contents | Read & Write | Read commit history, create/update releases |
| Metadata | Read | Repository metadata for identification |
| Pull Requests | Read | Extract PR references from commits |

## Events

| Event | Purpose |
|---|---|
| `push` | Detect tag pushes to auto-generate notes |
| `release` | Generate notes when a release is published/created |
| `installation` | Track app installations |

## Self-Hosting

You can self-host the Cullit GitHub App:

```bash
docker compose up app
```

Required environment variables:

| Variable | Description |
|---|---|
| `GITHUB_APP_ID` | Your GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key (base64-encoded) |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature verification secret |
| `CULLIT_APP_PORT` | Server port (default: 3001) |
| `CULLIT_AI_PROVIDER` | AI provider: `anthropic`, `openai`, `gemini`, `ollama`, `openclaw`, or `none` (default: `none`) |
| `CULLIT_AI_MODEL` | Model override (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |
| `CULLIT_AI_API_KEY` | API key for the chosen AI provider |

## Pricing

| Plan | Price | What you get |
|------|-------|--------------|
| **Free** | $0 | Template-based release notes (no AI), 5 generations/month, 3 projects |
| **Pro** | $9/mo | AI-powered notes (BYOK), Jira/Linear, Slack/Discord/GitHub Release, 500 gen/mo, 100 projects |
| **Team** | $19/seat/mo | Multi-repo, Confluence/Notion/Teams, hosted changelog, 10 seats, 2000 gen/mo, 250 projects |
| **Enterprise** | Custom | SSO/SAML, SLA, on-prem, unlimited generations &amp; projects — [sales@cullit.io](mailto:sales@cullit.io) |

The GitHub App is **free** with template-based notes. Activate AI-powered generation with a `CULLIT_API_KEY` (Pro or above).

## Support

- [Documentation](https://cullit.io/docs.html#github-app)
- [GitHub Issues](https://github.com/mttaylor/cullit/issues)
- Email: matt@cullit.io

## Links

- [Cullit Website](https://cullit.io)
- [Full Documentation](https://cullit.io/docs.html)
- [CLI on npm](https://www.npmjs.com/package/cullit)
