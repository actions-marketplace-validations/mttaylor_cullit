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

# Custom audience
cullit generate --from v1.0.0 --to HEAD --audience end-user
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
          publish-slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Features

| Feature | Description |
|---------|-------------|
| 🧠 **AI-Powered** | Claude & OpenAI generate categorized, human-readable notes |
| 🔑 **BYOK** | Bring your own API key. Zero vendor lock-in. |
| ⚡ **Flexible Triggers** | CLI, GitHub Action, or any two commits |
| 🔍 **Jira & Linear** | Enriches notes with ticket details from your project tools |
| 📤 **Multi-Publish** | Slack, Discord, GitHub Release, file, stdout |
| 🎯 **Audience Modes** | Developer, end-user, or executive summaries |
| 📋 **Smart Categories** | Features, fixes, breaking changes, improvements, chores |

## Configuration

Create `.cullit.yml` in your repo root (or run `cullit init`):

```yaml
ai:
  provider: anthropic
  audience: developer
  tone: professional
  categories: [features, fixes, breaking, improvements, chores]

source:
  type: local
  enrichment: [jira]

publish:
  - type: stdout
  - type: slack
    webhook_url: $SLACK_WEBHOOK_URL

jira:
  domain: yourcompany.atlassian.net
```

### Environment Variables

| Variable | Required For |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic/Claude AI |
| `OPENAI_API_KEY` | OpenAI |
| `JIRA_EMAIL` | Jira enrichment |
| `JIRA_API_TOKEN` | Jira enrichment |
| `LINEAR_API_KEY` | Linear enrichment |
| `SLACK_WEBHOOK_URL` | Slack publishing |
| `DISCORD_WEBHOOK_URL` | Discord publishing |

## Roadmap

- [x] Core CLI
- [x] Claude & OpenAI support
- [x] Jira enrichment
- [x] Linear enrichment
- [x] Slack & Discord publishers
- [ ] GitHub Release publisher
- [ ] Confluence publisher
- [ ] Notion publisher
- [ ] GitLab & Bitbucket support
- [ ] Hosted changelog pages
- [ ] Web dashboard
- [ ] API endpoint

## Contributing

PRs welcome. This is open source under the MIT license.

## License

MIT — see [LICENSE](LICENSE)

---

Built by [Matt](https://deployordie.io) • [Newsletter](https://deployordie.io) • [YouTube](https://youtube.com/@deployordie)
