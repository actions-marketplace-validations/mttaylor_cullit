# Cullit Website

This directory contains the static site for cullit.io.

## Pages

- `index.html` — marketing homepage
- `pricing.html` — support and sponsorship page
- `docs.html` — product and API documentation
- `tutorial.html` — onboarding walkthrough
- `setup.html` — guided setup flow
- `dashboard.html` — authenticated dashboard (auth, history, analytics, team, drafts)
- `changelog.html` — hosted changelog surface
- `free-trial.html` — redirects to dashboard
- `releases.html` — public release notes browser
- `privacy.html` — website privacy policy
- `terms.html` — website terms of service

## Deploy

The site is deployed via Cloudflare Workers using `wrangler` from the `site/` directory.

Recommended Cloudflare Workers setup:

1. Connect GitHub repo `mttaylor/cullit`
2. Configure `wrangler.toml` with the `site/` directory as the asset root
3. Deploy with `wrangler deploy` or via CI
4. Add custom domain `cullit.io`

## Notes

- `widget.ts` builds to `widget.js` via `pnpm run build:widget`
- Keep legal markdown (`../PRIVACY.md`, `../TERMS.md`) aligned with `privacy.html` and `terms.html`
- Keep docs/tutorial references aligned with shipped dashboard workflows and API endpoints
