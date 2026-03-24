# Contributing to Cullit

Thanks for your interest in contributing! Cullit is open source and PRs are welcome.

## Development Setup

```bash
# Clone
git clone https://github.com/mttaylor/cullit.git
cd cullit

# Install dependencies (requires pnpm 10+)
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint

# Verify lockfile consistency (CI parity)
pnpm lockfile:check

# Validate pricing/legal/docker consistency guards
pnpm validate:guards

# Install the pre-push gate once per clone
pnpm hooks:install

# Run CLI locally
node packages/cli/dist/index.js generate --from <tag1> --to <tag2>
```

## Architecture

Cullit is a pnpm monorepo with a staged pipeline architecture:

```
┌───────────┐    ┌──────────┐    ┌───────────┐    ┌───────────┐
│ Collector  │ →  │ Enricher │ →  │ Generator │ →  │ Publisher │
│ (git diff) │    │ (Jira/   │    │ (AI or    │    │ (stdout/  │
│            │    │  Linear) │    │  template)│    │  file/…)  │
└───────────┘    └──────────┘    └───────────┘    └───────────┘
```

**Pipeline stages:**
1. **Collect** — Gather commits between two refs (tags, SHAs, branches)
2. **Enrich** — Cross-reference commits with Jira/Linear tickets (optional, Pro)
3. **Generate** — Produce structured release notes via AI or the built-in template engine
4. **Publish** — Output to stdout, file, Slack, Discord, GitHub Release, etc.

## Project Structure

```
packages/
  config/   — Config loading (.cullit.yml), YAML parsing, type definitions
  core/     — Pipeline orchestration, git collector, template generator,
              formatting, license gating, constants
  cli/      — CLI entry point (parseArgs, commands)
  licensed/ — Private paid-tier distribution package (wraps CLI + pro plugins)
  api/      — REST API server (zero-dependency, Node http module)
  pro/      — Pro features: AI generators (Anthropic, OpenAI, Gemini,
              Ollama), source collectors (Jira, Linear, GitLab,
              Bitbucket), enrichers (Jira, Linear), publishers (Slack,
              Discord, Teams, GitHub Release, GitLab Release, Confluence,
              Notion, Changelog)
  app/      — GitHub App webhook handler (auto-generate on release/tag)
site/
  *.html    — Static marketing site, docs, dashboard, tutorial
```

**Dependency order:** `config` → `core` → `cli` / `api` / `pro` → `app`

## Testing

We use [vitest](https://vitest.dev/) for all tests.

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @cullit/core test

# Run a specific test file
pnpm vitest run packages/core/__tests__/gate.test.ts

# Run in watch mode
pnpm vitest packages/core
```

**Test conventions:**
- Test files live in `packages/<pkg>/__tests__/`
- Name test files `<module>.test.ts`
- Use `vi.stubEnv()` for environment variables, `vi.fn()` for mocks
- Mock `fetch` with `vi.stubGlobal('fetch', ...)` for HTTP tests
- Each test should be independent — no shared mutable state

## Code Style

- **TypeScript strict mode** — all packages use `strict: true`
- **ESM only** — use `import`/`export`, no CommonJS
- **No runtime dependencies** in `@cullit/core` — use Node built-ins only
- **Lint** with `pnpm lint` (ESLint + TypeScript rules)
- Prefer `const` over `let`, never use `var`
- Use `===` for equality checks
- Suffix unused parameters with `_` (e.g., `_req`)

## Commit Convention

Cullit uses [Conventional Commits](https://www.conventionalcommits.org/) since the tool itself relies on them:

```
feat: add GitLab release publisher
fix: handle empty commit messages in parser
docs: update env var table in docs
chore: bump vitest to 1.6.1
feat!: rename --output flag to --format (BREAKING)
```

Prefixes: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`, `build`

## Pull Requests

- Keep PRs focused on a single change
- Add tests for new features or bug fixes
- Run `pnpm test` and `pnpm lint` before submitting
- Run `pnpm lockfile:check` after any `package.json` change
- Run `pnpm validate:guards` when touching pricing/legal pages or Docker install config
- Install hooks once with `pnpm hooks:install` so `pnpm launch:ready` runs automatically on push
- Use conventional commit format for PR titles
- Fill out the PR description explaining what changed and why

### Documentation and Legal Updates

When behavior, pricing, tier limits, endpoints, or auth flows change, update docs in the same PR:

- Root docs: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`
- Website docs/tutorial: `site/docs.html`, `site/tutorial.html`, `site/setup.html`
- Legal markdown: `PRIVACY.md`, `TERMS.md`
- Website legal pages: `site/privacy.html`, `site/terms.html`

Avoid shipping feature changes without matching docs/legal updates.

## Issues

Found a bug or have a feature request? Open an issue on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
