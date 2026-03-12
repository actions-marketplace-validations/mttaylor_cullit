# Cullit Landing Page

This directory contains the static landing page for cullit.io, hosted on Cloudflare Pages.

## Deploy

This is deployed automatically via Cloudflare Pages connected to the `site/` directory in this repo.

### Cloudflare Pages Setup

1. Go to Cloudflare Dashboard → Pages → Create a project
2. Connect to GitHub repo `mttaylor/cullit`
3. Set build settings:
   - **Build command:** (leave blank — static HTML)
   - **Build output directory:** `site`
4. Deploy
5. Add custom domain: cullit.io
