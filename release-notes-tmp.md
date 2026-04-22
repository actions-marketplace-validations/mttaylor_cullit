# Cullit v2.10.0 — Integration Verify Harness + Architectural Refactor

This release introduces a **live integration verification harness** for diagnosing connectivity to AI providers, Linear, Jira, GitHub and Stripe — plus a **major god-file refactor** that splits the monolithic API and GitHub App entry points into focused per-domain modules. **Zero breaking changes.** All 667 tests pass.

## Highlights

### `cullit verify` — Diagnose your integrations
A new CLI command and `POST /v1/integrations/test` endpoint that probes each configured integration and reports `ok / unreachable / auth-failed / misconfigured` with latency. Includes 13 new e2e tests in `packages/pro/__tests__/live-integrations.test.ts`.

### Architectural refactor — God-files broken up
- **`packages/api/src/db.ts`**: 1631 -> 11 lines (now a barrel re-export over `db/` modules).
- **`packages/api/src/index.ts`**: 1198 -> 165 lines. Extracted into:
  - `routes/index.ts` (declarative route table)
  - `routes/{generate,system,analytics,audit-templates,billing,github-app,project-settings,integrations}.ts`
  - `server-config.ts` (CORS, rate limit, prod env assertion)
- **`packages/app/src/index.ts`**: 646 -> 185 lines. Extracted into:
  - `config.ts`, `util.ts`, `github-api.ts`, `handlers.ts`, `metrics.ts`

Net: **~3,100 lines moved out of god-files** into ~15 focused modules. Existing imports keep working via barrel re-exports.

## Security
- New `scripts/audit-security.mjs` companion audit pipeline.
- SSRF guard for Jira domain checks (`isBlockedJiraDomain`).
- TRUST_PROXY-aware client IP extraction in `server-config.ts`.

## Tests
- **52 test files, 667 tests, all passing.**
- 13 new live integration tests (skipped when keys absent).

## Upgrade
```bash
npm install -g @cullit/cli@2.10.0
```

No config changes required.
