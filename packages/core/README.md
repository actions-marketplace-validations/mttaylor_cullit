# @cullit/core

Core engine for Cullit — AI-powered release note generation.

This package provides the pipeline orchestration, git collector, template generator, formatting utilities, license gating, and shared constants used by all Cullit surfaces (CLI, API, GitHub App).

## Features

- **Pipeline orchestration** — Collector → Enricher → Generator → Publisher
- **Git collector** — Extract commits between any two refs
- **Template generator** — Categorized, structured release notes without AI
- **License gating** — Tier-based feature access (Free / Pro / Enterprise)
- **Output formatting** — Markdown, HTML themes, JSON
- **Constants** — Tier definitions, version, pricing, limits

## Install

```bash
npm install @cullit/core
```

## Usage

```ts
import { runPipeline } from '@cullit/core';
import { TIERS, VERSION } from '@cullit/core';
```

This package is a dependency of `cullit` (CLI), `@cullit/api`, `@cullit/pro`, and `@cullit/app`. It is published to the public npm registry.

## Docs

- Full docs: https://cullit.io/docs
- Repository: https://github.com/mttaylor/cullit
