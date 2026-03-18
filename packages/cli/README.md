# cullit CLI

AI-powered release notes from your terminal.

`cullit` reads your git history (and optionally Jira/Linear context), then generates and publishes release notes to the channels your team already uses.

## Install

```bash
# one-off
npx cullit generate --from v1.0.0 --to v1.1.0

# global
npm install -g cullit

# dev dependency
npm install -D cullit
```

## Quick Start

```bash
# initialize .cullit.yml
cullit init

# generate between refs
cullit generate --from v1.0.0 --to v1.1.0

# autodetect last two tags
cullit generate

# no AI key needed (template mode)
cullit generate --from HEAD~10 --provider none
```

## Common Flags

- `--from <ref>` source git ref / tag / query
- `--to <ref>` target ref (defaults to `HEAD`)
- `--provider <name>` `anthropic|openai|gemini|ollama|openclaw|none`
- `--model <id>` override model
- `--audience <type>` tune output for `developer|user|stakeholder`
- `--tone <style>` tone controls for generated output
- `--format <fmt>` output format
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
