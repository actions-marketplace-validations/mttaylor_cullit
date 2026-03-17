# Cullit Landing Page

This directory contains the static site for cullit.io.

## Deploy

This is deployed automatically via Cloudflare, connected to the `site/` directory in this repo.

### Setup

1. Connect GitHub repo `mttaylor/cullit`
2. Set build settings:
   - **Build command:** `rm -f ../pnpm-workspace.yaml`
   - **Build output directory:** `site`
3. Deploy
4. Add custom domain: cullit.io
