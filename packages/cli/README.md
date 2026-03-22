# cullit CLI

Public CLI installer for Cullit's local, template-based workflow.

The `cullit` package on npm is intentionally limited to the free local surface:

- local git collection
- template generation with `--provider none`
- stdout and file publishing
- config, status, and tag helpers

Installing from npm does not grant paid access by itself. Licensed AI providers, Jira/Linear enrichment, premium publishers, dashboard workflows, and other paid surfaces are delivered through Cullit-hosted or private licensed distributions.

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
- Paid tiers (Pro, Team, Enterprise): delivered through the private package `@cullit/licensed`
- `CULLIT_API_KEY`: used by licensed hosted/private Cullit surfaces
- Need Pro or Team access: https://cullit.io/pricing

## Common Flags

- `--from <ref>` source git ref / tag / query
- `--to <ref>` target ref (defaults to `HEAD`)
- `--provider <name>` `anthropic|openai|gemini|ollama|none`
- `--model <id>` override model
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
