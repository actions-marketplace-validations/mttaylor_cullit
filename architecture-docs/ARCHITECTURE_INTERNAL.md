# Cullit Architecture

Last updated: 2026-05-04

This document is the source of truth for Cullit's technical architecture, distribution model, runtime flows, and operational boundaries.

## Scope

- Monorepo package topology
- Open-source distribution boundaries
- Runtime plugin registration and compatibility behavior
- API and dashboard request flows
- Quality gates and release checks

## Package Topology

```mermaid
flowchart TD
  Cfg["@cullit/config"]
  Core["@cullit/core"]
  Cli["cullit public npm CLI"]
  Pro["@cullit/pro internal plugin package"]
  Api["@cullit/api private API server"]
  App["@cullit/app private GitHub App"]

  Cfg --> Core
  Core --> Cli
  Core --> Pro
  Core --> Api
  Pro --> Api
  Core --> App
  Pro --> App
```

## Distribution Model

```mermaid
flowchart LR
  User["All users"]
  NpmPublic["npm public registry"]
  PublicPkg["cullit"]
  Sponsors["GitHub Sponsors"]

  User --> NpmPublic --> PublicPkg
  User --> Sponsors
```

### Boundaries

- `cullit` is the public package for all workflows.
- Paid plan-specific distribution packages are retired.
- `@cullit/pro` remains an internal package in the monorepo, but no longer represents a paywall boundary.

## Runtime Plugin Registration

```mermaid
sequenceDiagram
  participant U as User
  participant CLI as cullit CLI runtime
  participant REG as core registry
  participant PRO as @cullit/pro plugins
  participant PIPE as runPipeline

  U->>CLI: cullit generate ...
  CLI->>PRO: import plugins (if available)
  PRO->>REG: register collectors enrichers generators publishers
  CLI->>PIPE: runPipeline(from,to,config)
  PIPE->>REG: resolve factories by source/provider/publisher
  REG-->>PIPE: factory functions
  PIPE-->>U: formatted notes and publish results
```

## Gating and Tier Controls

```mermaid
flowchart TD
  Start[runPipeline]
  Validate[validateLicense compatibility]
  Provider{provider selected?}
  Enrich{enrichment configured?}
  Publisher{publisher configured?}
  End[Pipeline completed]

  Start --> Validate --> Provider
  Provider -- no --> Stop1[skip provider stage]
  Provider -- yes --> Enrich
  Enrich -- no --> Skip1[skip enrichment stage]
  Enrich -- yes --> DoEnrich[run enrichment]
  Skip1 --> Publisher
  DoEnrich --> Publisher
  Publisher -- no --> Skip2[skip publisher stage]
  Publisher -- yes --> DoPub[publish]
  Skip2 --> End
  DoPub --> End
```

### Tier Expectations

- Legacy tier values (`free`, `paid`, `pro`, `team`, `enterprise`) are kept for compatibility and analytics continuity.
- Runtime behavior is open-access: features are not blocked by tier.
- Billing endpoints are retained as compatibility stubs and no longer perform checkout.

## API and Dashboard Flow

```mermaid
sequenceDiagram
  participant B as Browser dashboard
  participant A as API server
  participant AU as auth module
  participant DB as data store

  B->>A: GET /auth/me
  A->>AU: resolveUser(cookie or Bearer clt_ key)
  AU-->>A: user or null
  A-->>B: tier effectiveTier

  B->>A: POST /generate
  A->>AU: resolveUser
  A->>A: apply compatibility checks and execute pipeline
  A->>A: runPipeline
  A->>DB: record history and usage
  A-->>B: generated notes and metadata
```

## Quality Gates

```mermaid
flowchart LR
  Code[Code changes]
  Build[pnpm build]
  Unit[pnpm test]
  E2E[pnpm test:e2e]
  Guards[pnpm validate:guards]
  Launch[pnpm launch:ready]
  Ready[Ready to merge]

  Code --> Build --> Unit --> E2E --> Guards --> Launch --> Ready
```

## Operational Notes

- Sponsorship CTA should point to `https://github.com/sponsors/mttaylor`.
- Billing and Stripe references in product docs are considered legacy and should be removed when touched.
- Public docs should reflect open-source and contribution-first messaging.

## Documentation Maintenance Policy

When architecture, distribution, or runtime flows change, update this file in the same PR.

Required updates when relevant:

- package topology or dependency direction changes
- compatibility tier behavior or install paths change
- authentication or gating logic changes
- API route behavior affecting dashboard/runtime flows changes
- build/test pipeline changes

If a PR changes any of the above and this file is untouched, treat that as a documentation gap.
