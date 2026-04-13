# Pricing

Cullit has three tiers: **Free**, **Paid**, and **Enterprise**.

| Plan | Price | Generations | Projects | Features |
| --- | --- | --- | --- | --- |
| Free | $0 | 3 / month | 3 | Template only, stdout/file output |
| Paid | $8 / seat / month | 500+ / month (100/seat scaling) | 100+ (5/seat scaling) | All features: AI providers, enrichment, publishers, dashboard, orgs, drafts, changelogs |
| Enterprise | Custom | Unlimited | Unlimited | SSO/SAML, dedicated support, on-prem, custom SLA |

Annual billing is available for Paid at **$6.80 / seat / month** ($81.60 / seat / year — 15% off).

## Feature Comparison

| Feature | Free | Paid | Enterprise |
| --- | --- | --- | --- |
| Template-based generation | ✓ | ✓ | ✓ |
| AI providers (BYOK) | 3 gens/month | ✓ | ✓ |
| Jira & Linear enrichment | — | ✓ | ✓ |
| Audience & tone control | — | ✓ | ✓ |
| Multi-format output (Markdown, HTML, JSON) | ✓ | ✓ | ✓ |
| Slack, Discord, Teams publishers | — | ✓ | ✓ |
| GitHub Release & GitLab Release publishers | — | ✓ | ✓ |
| Confluence & Notion publishers | — | ✓ | ✓ |
| Hosted changelog & embeddable widget | — | ✓ | ✓ |
| GitLab & Bitbucket collectors | — | ✓ | ✓ |
| Dashboard & generation history | — | ✓ | ✓ |
| GitHub App (auto-generate on release) | — | ✓ | ✓ |
| Drafts & approvals | — | ✓ | ✓ |
| Organization management & team API keys | — | ✓ | ✓ |
| Project templates | — | ✓ | ✓ |
| Audit logs | — | ✓ | ✓ |
| SSO / SAML | — | — | ✓ |
| Dedicated support & SLA | — | — | ✓ |
| On-premises deployment | — | — | ✓ |

## Messaging Guidance

When describing Cullit publicly:

1. Lead with **Free to try**
2. Position **Paid** as the default production plan
3. Describe collaboration, org keys, approvals, and governance as part of paid usage
4. Reserve **Enterprise** for SSO, procurement, and support-heavy deals

## Environment Variables

The primary Stripe price variables are:

- `STRIPE_PAID_PRICE_ID` — Stripe price ID for the paid plan ($8/seat/month)
- `STRIPE_PAID_ANNUAL_PRICE_ID` — Stripe price ID for the paid annual plan ($81.60/seat/year)

> **Fallback:** The older `STRIPE_PRO_PRICE_ID`, `STRIPE_PRO_ANNUAL_PRICE_ID`, `STRIPE_TEAM_PRICE_ID`, and `STRIPE_TEAM_ANNUAL_PRICE_ID` variables still work as fallbacks if the `STRIPE_PAID_*` variants are not set.

## Legacy Tier Mapping

Existing subscribers on the former **Pro** or **Team** plans are automatically mapped to the **Paid** tier at the code level. No action is required — all Pro/Team features are included in Paid. The `STRIPE_PRO_*` and `STRIPE_TEAM_*` environment variables remain functional as fallbacks during the transition period.
