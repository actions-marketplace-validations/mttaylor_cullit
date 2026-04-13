# Cullit Architecture

Last updated: 2026-03-27

This document is the source of truth for Cullit's technical architecture, distribution model, runtime flows, and operational boundaries.

## Scope

- Monorepo package topology
- Free vs paid distribution boundaries
- Runtime plugin registration and gating
- API and dashboard request flows
- Quality gates and release checks

## Package Topology

```mermaid
flowchart TD
  Cfg["@cullit/config"]
  Core["@cullit/core"]
  Cli["cullit public npm CLI"]
  Pro["@cullit/pro private plugin package"]
  Lic["@cullit/licensed private paid distribution"]
  Api["@cullit/api private API server"]
  App["@cullit/app private GitHub App"]

  Cfg --> Core
  Core --> Cli
  Core --> Pro
  Pro --> Lic
  Cli --> Lic
  Core --> Api
  Pro --> Api
  Core --> App
  Pro --> App
```

## Distribution Model

```mermaid
flowchart LR
  PublicUser["Free user"]
  PaidUser["Paid / Enterprise user"]
  NpmPublic["npm public registry"]
  NpmPrivate["private npm registry"]
  PublicPkg["cullit"]
  LicensedPkg["@cullit/licensed"]

  PublicUser --> NpmPublic --> PublicPkg
  PaidUser --> NpmPrivate --> LicensedPkg
  LicensedPkg --> PublicPkg
```

### Boundaries

- `cullit` is the public package for local/template workflows.
- `@cullit/licensed` is the private distribution package for paid tiers.
- `@cullit/pro` remains internal/private plugin implementation and is not a public customer install target.

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
  Validate[validateLicense]
  Provider{provider allowed?}
  Enrich{enrichment allowed?}
  Publisher{publisher allowed?}
  End[Pipeline completed]

  Start --> Validate --> Provider
  Provider -- no --> Stop1[throw upgrade message]
  Provider -- yes --> Enrich
  Enrich -- no --> Skip1[skip enrichment]
  Enrich -- yes --> DoEnrich[run enrichment]
  Skip1 --> Publisher
  DoEnrich --> Publisher
  Publisher -- no --> Skip2[skip publisher]
  Publisher -- yes --> DoPub[publish]
  Skip2 --> End
  DoPub --> End
```

### Tier Expectations

- Free: local source + template provider + stdout/file publishers. 3 AI gens/month (BYOK).
- Paid ($8/seat/mo): All features — AI providers, enrichment, publishers, dashboard, orgs, drafts, team keys. 500+ gens/month, 100+ projects. Scales with seat count. Annual billing at $6.80/seat/mo.
- Enterprise: All Paid capabilities plus SSO/SAML, dedicated support, on-prem, unlimited gens/projects.

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
  A->>A: check monthly limits by effective tier
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

- `@cullit/licensed` should be published only to private registries.
- Customer onboarding should include `.npmrc` private registry auth setup.
- Public docs must never instruct paid users to install `@cullit/pro` directly.

## Documentation Maintenance Policy

When architecture, distribution, or runtime flows change, update this file in the same PR.

Required updates when relevant:

- package topology or dependency direction changes
- free/paid boundaries or install paths change
- authentication or gating logic changes
- API route behavior affecting dashboard/runtime flows changes
- build/test pipeline changes

If a PR changes any of the above and this file is untouched, treat that as a documentation gap.
