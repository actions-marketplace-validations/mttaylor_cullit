# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability, please report it responsibly.

**DO NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. **Email:** Send details to **matt@cullit.io**
2. **Subject line:** `[SECURITY] Cullit — <brief description>`
3. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment:** Within 48 hours of your report
- **Assessment:** We'll evaluate severity and impact within 5 business days
- **Resolution:** Critical issues patched within 7 days; others within 30 days
- **Credit:** We'll credit you in the release notes (unless you prefer anonymity)

## Security Practices

### API Keys & Secrets

- Cullit uses **BYOK (Bring Your Own Key)** — we never store or transmit your API keys beyond the single request to the AI provider
- Keys are resolved from environment variables or config files at runtime
- The `.env` file is in `.gitignore` by default
- In GitHub Actions, use [encrypted secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

### Data Handling

- Cullit processes git commit messages and ticket metadata locally
- Data is sent only to the AI provider you configure (Anthropic, OpenAI, Gemini, Ollama, or OpenClaw)
- No telemetry, analytics, or data collection is performed
- Self-hosted options (Ollama, OpenClaw) keep all data on your infrastructure

### Dependencies

- We minimize external dependencies
- The API server uses Node.js built-in `http` module (zero dependencies)
- Dependencies are audited with `pnpm audit` before releases

### Docker

- Multi-stage builds minimize the attack surface
- Production images run on `node:20-alpine` (minimal base)
- No root user in production containers

## Scope

The following are **in scope** for security reports:

- CLI, API server, and GitHub Action code
- Authentication/authorization bypass
- Injection vulnerabilities (command injection, etc.)
- Secrets exposure
- Supply chain risks in dependencies

The following are **out of scope:**

- Vulnerabilities in third-party AI providers (Anthropic, OpenAI, etc.)
- Social engineering
- Denial of service against self-hosted instances
- Issues requiring physical access

## PGP Key

For encrypted communications, request our PGP key at matt@cullit.io.
