# Ship It — Full Release Workflow

Run the complete Cullit release workflow. Determine the version bump type from recent commits since the last tag (patch for fixes, minor for features, major for breaking changes).

## Steps

1. **Determine version bump**: Check `git log` since the last tag. Classify as patch/minor/major based on conventional commit prefixes (fix: = patch, feat: = minor, BREAKING CHANGE or !: = major).
2. **Bump version**: Run `node scripts/bump-version.mjs <patch|minor|major>` (updates 8 package.json files + constants.ts).
3. **Update landing page hero badge**: Update the `<a>` tag in `site/index.html` hero section with the new version and a short summary of key changes.
4. **Build + test**: Run `pnpm build` then `pnpm test`. All tests must pass (627+) before proceeding. If tests fail, fix them before continuing.
5. **Commit + tag + push**: `git add -A && git commit -m "chore: bump version to vX.Y.Z" && git tag vX.Y.Z && git push origin main --tags`
6. **Create GitHub release**: Use `gh release create vX.Y.Z` with detailed markdown release notes covering features, fixes, tests, and contributors.
7. **Generate site release notes**: Run `node scripts/generate-release-notes.mjs vX.Y.Z` to dogfood Cullit and generate `site/releases/vX.Y.Z.json` + update `site/releases/index.json` with all AI providers.
8. **Commit + push site changes**: `git add -A && git commit -m "docs: vX.Y.Z release notes, landing page hero badge update" && git push origin main`

## Notes

- The `site/index.html` hero badge format is: `New in vX.Y.Z: <short summary> →`
- The generate-release-notes script auto-updates `site/releases/index.json`
- If AI provider keys are missing, at minimum run with `--providers template` as fallback
- Always verify 627+ tests pass before tagging
