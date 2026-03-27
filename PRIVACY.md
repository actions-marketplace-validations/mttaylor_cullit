# Privacy Policy

**Last updated:** June 27, 2026

## Overview

Cullit is an open-source release notes platform (CLI, API server, GitHub Action, GitHub App, and web dashboard). This policy explains what data is processed, where it is processed, and when Cullit stores data.

## What Data Cullit Processes

Depending on the features you enable, Cullit may process:

- **Source control metadata**: commit messages, SHAs, author names, tags, and timestamps
- **Issue tracker metadata**: Jira/Linear issue titles, descriptions, labels, and statuses
- **Generated release content**: summaries, categorized notes, formatted markdown/html output
- **Team workflow metadata**: drafts, revisions, project settings, org membership and invites
- **Billing/account metadata**: subscription state and customer identifiers from Stripe

Cullit only processes data you explicitly provide through configured sources and API calls.

## Product Modes and Storage Behavior

### CLI / local mode

- Runs on your machine
- Uses your local files, environment variables, and configured provider endpoints
- Does not require a Cullit-hosted account

### Self-hosted API mode

- You control infrastructure, logs, and retention
- Data is stored in your configured database when enabled (`DATABASE_URL`)
- You are responsible for access control, backup, and compliance for your deployment

### Hosted dashboard mode

- Uses GitHub OAuth login and session cookies for authentication
- Stores account, usage, team, and draft workflow records required for app functionality
- Uses Stripe for subscription and billing state

## Cookies and Local Storage

- Cullit uses an authentication session cookie (`cullit_session`) for dashboard login
- Cullit uses browser local storage for non-sensitive UX preferences (for example API URL defaults)
- Cullit does not use advertising or third-party tracking cookies

## Third-Party AI Providers

Cullit sends release input data to the provider you configure. Each provider has its own privacy policy:

| Provider | Privacy Policy |
|----------|---------------|
| Anthropic (Claude) | [anthropic.com/privacy](https://www.anthropic.com/privacy) |
| OpenAI | [openai.com/privacy](https://openai.com/privacy) |
| Google (Gemini) | [ai.google/privacy](https://ai.google/responsibility/privacy/) |
| Ollama | Self-hosted (your environment) |


Your provider choice determines where model inference data is processed.

## Billing and Payment Data

- Billing is processed through Stripe
- Cullit stores subscription state and Stripe identifiers needed to manage plans
- Full payment card data is handled by Stripe, not stored by Cullit

## API Keys and Secrets

- Secrets are loaded from environment variables or local config
- Do not commit secrets into source control
- In CI/CD, use secret managers or encrypted repository secrets

## Security and Retention

- Access controls and retention depend on deployment mode (local, self-hosted, or hosted dashboard)
- We recommend least-privilege tokens and short retention windows for logs containing operational metadata

For vulnerability reporting, see [SECURITY.md](SECURITY.md).

## Open Source Transparency

Cullit source code is available at [github.com/mttaylor/cullit](https://github.com/mttaylor/cullit).

## Contact

For privacy questions: **matt@cullit.io**

## Changes

We may update this policy as Cullit evolves. Material updates will be reflected by updating the date above.
