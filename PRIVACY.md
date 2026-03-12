# Privacy Policy

**Last updated:** March 12, 2026

## Overview

Cullit is an open-source CLI tool and GitHub Action for generating AI-powered release notes. This policy describes how Cullit handles data.

## What Data Cullit Processes

When you run Cullit, it processes:

- **Git commit messages** — author names, commit messages, SHAs, and timestamps from your local repository
- **Jira/Linear metadata** — issue titles, descriptions, labels, and statuses (only when you explicitly configure these sources)
- **AI API calls** — the above data is sent to your configured AI provider to generate release notes

## What Cullit Does NOT Collect

- **No telemetry** — Cullit does not phone home, track usage, or collect analytics
- **No user accounts** — There are no accounts, logins, or user profiles
- **No data storage** — Cullit does not store your data on any server. All processing is local or directly between you and your AI provider
- **No cookies or tracking** — The cullit.io website is a static landing page with no tracking scripts

## Third-Party AI Providers

Cullit sends your commit/ticket data to the AI provider you configure. Each provider has its own privacy policy:

| Provider | Privacy Policy |
|----------|---------------|
| Anthropic (Claude) | [anthropic.com/privacy](https://www.anthropic.com/privacy) |
| OpenAI | [openai.com/privacy](https://openai.com/privacy) |
| Google (Gemini) | [ai.google/privacy](https://ai.google/responsibility/privacy/) |
| Ollama | Self-hosted — data stays on your machine |
| OpenClaw | Self-hosted — data stays on your infrastructure |

**Your choice of provider determines where your data goes.** For maximum privacy, use Ollama or OpenClaw to keep everything on-premise.

## API Keys

- API keys are loaded from environment variables or local config files
- Keys are used only for the duration of the API call and are never persisted, logged, or transmitted elsewhere
- In CI/CD environments, use encrypted secrets (e.g., GitHub Actions secrets)

## Self-Hosted API Server

If you deploy the Cullit API server:

- You are responsible for securing the server and any data it processes
- The API server does not include authentication by default — add it via a reverse proxy or middleware for production use
- No data is sent to Cullit or Deploy or Die from your self-hosted instance

## Open Source

Cullit is fully open source under the MIT license. You can audit the entire codebase at [github.com/deployordie/cullit](https://github.com/deployordie/cullit).

## Contact

For privacy questions: **matt@cullit.io**

## Changes

We may update this policy as Cullit evolves. Changes will be committed to the repository with a clear changelog.
