# Cullit Website

This directory contains the static site for cullit.io.

## Pages

- `index.html` — marketing homepage
- `pricing.html` — pricing and plan comparison
- `docs.html` — product and API documentation
- `tutorial.html` — onboarding walkthrough
- `setup.html` — guided setup flow
- `dashboard.html` — authenticated dashboard (auth, billing, history, analytics, team, drafts)
- `changelog.html` — hosted changelog surface
- `privacy.html` — website privacy policy
- `terms.html` — website terms of service

## Deploy

The site is deployed via Cloudflare Pages from the `site/` directory.

Recommended Cloudflare Pages settings:

1. Connect GitHub repo `mttaylor/cullit`
2. Set **Root directory** to `site`
3. Set **Build command** to empty (static site)
4. Set **Build output directory** to `.`
5. Add custom domain `cullit.io`

## Notes

- `widget.ts` builds to `widget.js` via `pnpm run build:widget`
- Keep legal markdown (`../PRIVACY.md`, `../TERMS.md`) aligned with `privacy.html` and `terms.html`
- Keep docs/tutorial references aligned with shipped dashboard workflows and API endpoints
