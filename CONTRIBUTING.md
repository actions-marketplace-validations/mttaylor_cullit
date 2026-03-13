# Contributing to Cullit

Thanks for your interest in contributing. Cullit is open source and PRs are welcome.

## Development Setup

```bash
# Clone
git clone https://github.com/mttaylor/cullit.git
cd cullit

# Install dependencies
pnpm install

# Build
pnpm build

# Test
pnpm test

# Run CLI locally
node packages/cli/dist/index.js generate --from <tag1> --to <tag2>
```

## Project Structure

```
packages/
  core/     — Shared logic (git, AI, integrations, formatting)
  cli/      — CLI entry point
  config/   — Config loading + validation
  api/      — REST API server
src/
  action.ts — GitHub Action wrapper (bundled to dist/)
```

## Pull Requests

- Keep PRs focused on a single change
- Add tests for new features
- Run `pnpm test` before submitting
- Follow existing code style

## Issues

Found a bug or have a feature request? Open an issue on GitHub.

## License

MIT — see [LICENSE](LICENSE)
