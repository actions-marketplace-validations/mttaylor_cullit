# cullit CLI

Public CLI installer for Cullit's local, template-based workflow.

The `cullit` package on npm is intentionally limited to the free local surface:

- local git collection
- template generation with `--provider none`
- stdout and file publishing
- config, status, and tag helpers

Installing from npm does not grant Pro access by itself. Licensed AI providers, Jira/Linear enrichment, premium publishers, dashboard workflows, and other Pro surfaces are delivered through Cullit-hosted or private licensed distributions.

## Install

```bash
# one-off free local run
npx cullit generate --from v1.0.0 --to v1.1.0 --provider none

# global install
npm install -g cullit

# dev dependency
npm install -D cullit
```

## Quick Start

```bash
# initialize .cullit.yml
cullit init

# generate between refs with the built-in template engine
cullit generate --from v1.0.0 --to v1.1.0 --provider none

# autodetect the last two tags
cullit generate --provider none

# write release notes to a file
cullit generate --from HEAD~10 --provider none --format markdown --dry-run

# select a named template profile from .cullit.yml
cullit generate --from v1.8.0 --provider none --template customer-facing
```

## Licensing

- Public npm package: free local/template workflow only
- Paid tiers (Pro and Enterprise): delivered through the private package `@cullit/licensed`
- `CULLIT_API_KEY`: used by licensed hosted/private Cullit surfaces
- Need Pro access? See https://cullit.io/pricing

## Commands

### `generate`

Generate release notes between two git refs.

```bash
cullit generate --from v1.0.0 --to v1.1.0 --provider none
cullit generate --provider none          # autodetect last two tags
```

### `init`

Create a `.cullit.yml` config file via interactive prompts.

```bash
cullit init
```

### `status`

Show release readiness: current version, unreleased commit count and breakdown, suggested next version, and a release/no-release verdict.

```bash
cullit status
```

### `tags`

List the 20 most recent tags in the current repository.

```bash
cullit tags
```

### `--version` / `-v`

Print the installed CLI version.

```bash
cullit --version
```

## Common Flags

- `--from <ref>` source git ref / tag / query
- `--to <ref>` target ref (defaults to `HEAD`)
- `--provider <name>` `anthropic|openai|gemini|ollama|none`
- `--model <id>` override model
- `--source <type>` `local|jira|linear|gitlab|bitbucket|multi-repo` (default: `local`)
- `--format <fmt>` `markdown|html|json` (default: `markdown`)
- `--audience <who>` `developer|end-user|executive`
- `--tone <style>` `professional|casual|terse|edgy|hype|snarky`
- `--dry-run` print to stdout without publishing
- `--template <name>` use a named template profile from `.cullit.yml`

> **Note:** Sources other than `local`, and providers other than `none`, require a Pro tier via `@cullit/licensed`.
- `--audience <type>` tune output for `developer|end-user|executive`
- `--tone <style>` tone controls for generated output
- `--format <fmt>` output format
- `--template <name>` select named template profile from config
- `--quiet` minimal logs
- `--verbose` detailed logs

## Docs

- Full docs: https://cullit.io/docs
- Tutorial: https://cullit.io/tutorial
- Pricing: https://cullit.io/pricing

## Source and Issues

- Repository: https://github.com/mttaylor/cullit
- Issues: https://github.com/mttaylor/cullit/issues
- Security: see `SECURITY.md` in the repository
