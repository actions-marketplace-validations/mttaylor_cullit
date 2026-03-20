# Stricter Paid Model — Concrete Options

This document outlines three concrete approaches for making the Cullit distribution model harder to accidentally misuse, and the trade-offs of each.

---

## Current State (as of audit)

- `npm install -g cullit` installs the public CLI that runs in `--provider none` (free/local) mode by default.
- All paid features (AI providers, Jira/Linear enrichments, premium publishers) are gated by `CULLIT_API_KEY` via `validateLicense()` in `@cullit/core`.
- `@cullit/pro` is private and workspace-only — not on npm. Pro publishers cannot be installed from npm at all.
- The gate is architecturally sound; the previous problem was only in docs/messaging (now fixed).

---

## Option A — Thin Installer (recommended for SaaS clarity)

Replace the current public `cullit` npm package with a minimal installer shim. The shim's only job is to download the real versioned binary from a CDN or the Cullit API once a license key is confirmed.

**How it works:**
1. User runs `npm install -g cullit`.
2. A `postinstall` script checks for `CULLIT_API_KEY`.
   - If present: downloads the full CLI binary signed for that license tier.
   - If absent: installs only the free/local binary (current behaviour).
3. The full binary is gated at the download level — it never reaches free users.

**Pros:**
- Completely removes the "install npm and unlock everything" misconception.
- Binary can contain code that never ships publicly.
- Easy licence rotation: re-run `cullit bootstrap` to swap the binary.

**Cons:**
- Adds a CDN/download infrastructure dependency.
- `postinstall` scripts are distrusted by some security-conscious teams; `npm install --ignore-scripts` breaks it.
- More ops overhead per release.

**Files to change:** `packages/cli/package.json` (add `postinstall`), new `packages/cli/src/bootstrap.ts`.

---

## Option B — Private npm Package with Scoped Registry Auth

Keep the public `cullit` on npm as the free local CLI. Add a second package `@cullit/licensed` published to a private registry (e.g. GitHub Packages, Cloudsmith, or a self-hosted Verdaccio) that customers install after receiving registry credentials.

**How it works:**
1. Free users: `npm install -g cullit` — local/template only, no AI.
2. Licensed users: receive a `.npmrc` snippet with registry credentials, then run `npm install -g @cullit/licensed`.
3. `@cullit/licensed` contains the full pipeline with all providers, enrichers, and publishers pre-wired (no runtime license check required).

**Pros:**
- npm's own auth model enforces access — no code change needed to the gate logic.
- Clean separation: two distinct packages, two distinct surfaces.
- Easy to audit who has access (registry access log).

**Cons:**
- Users manage registry credentials, which is friction.
- Requires standing up or paying for a private registry.
- Two npm packages to maintain and keep in sync.

**Files to change:** New `packages/licensed/` package, CI publishing workflow, customer onboarding docs.

---

## Option C — Authenticated Bootstrap Flow (lowest friction, incremental)

Keep the current architecture but add a one-time `cullit auth` command that exchanges the license key for a short-lived session token stored in `~/.cullit/credentials`. All paid operations check the cached session before running; unauthenticated runs fall back to free tier silently.

This is an enhancement of the current `validateLicense()` 24h cache, exposed as a first-class CLI flow.

**How it works:**
1. Free user: `npx cullit generate --provider none` — works as today.
2. Licensed user: runs `cullit auth` once, enters their license key, receives a session token.
3. All subsequent invocations read the cached token; no `CULLIT_API_KEY` env var needed.
4. Token expiry triggers a re-auth prompt rather than a silent failure.

**Pros:**
- Minimal infrastructure change — builds directly on `validateLicense()`.
- No new packages or registries.
- Better UX than env var management (token stored per-machine rather than per-shell).

**Cons:**
- Doesn't prevent a determined user from sharing the raw license key.
- Still relies on the honour system for key distribution (same as current).
- Does not hide the code that implements paid features from npm-installed packages.

**Files to change:**
- `packages/cli/src/index.ts`: add `cullit auth [login|logout|status]` command.
- `packages/cli/src/credentials.ts`: new file — read/write `~/.cullit/credentials.json`.
- `packages/core/src/gate.ts`: `validateLicense()` reads from credentials store as fallback after env var.

---

## Recommendation

| Goal | Best Option |
|---|---|
| Maximum code isolation (paid code never ships to free users) | **A** (thin installer) or **B** (private registry) |
| Minimum new infrastructure | **C** (auth flow) |
| Best developer UX | **C** then **B** |
| Compliance / audit trail | **B** (registry access log) |

For the current stage of Cullit, **Option C** is the most pragmatic: it improves usability (no env var juggling), closes the silent-failure UX gap, and requires no new infrastructure. Options A or B become relevant once you need to ship private code that must never be visible on npm.

---

## Next Steps for Option C

If Option C is chosen, the concrete implementation is:

```
packages/cli/src/credentials.ts   — new file
packages/cli/src/index.ts         — add `cullit auth` commands, update validateLicense() call site
packages/core/src/gate.ts         — extend validateLicense() to accept a credentialsPath option
packages/cli/__tests__/auth.test.ts — new test file
```

Estimated scope: ~200 lines of new code, 0 infrastructure changes.
