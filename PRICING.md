# Pricing

Cullit is standardizing around a simpler commercial model:

- **Free** — evaluate Cullit with template workflows and a small monthly AI allowance
- **Paid** — seat-based access with monthly or annual billing
- **Enterprise** — custom pricing for SSO, compliance, procurement, and larger deployment needs

## Current Direction

The intended public model is:

| Plan | Price | Notes |
| --- | --- | --- |
| Free | $0 | Trial tier for local CLI, template workflows, and limited monthly usage |
| Paid | $8 per seat / month | Annual billing available; paid access is the main commercial offer |
| Enterprise | Custom | SSO/SAML, procurement, support, and higher-touch deployment options |

## Transition Note

The billing system is still in transition from older package names.

- Some checkout, dashboard, and Stripe configuration surfaces still refer to legacy **Pro** and **Team** packages
- The current single-seat starter package is still priced separately
- The current org package still uses 5+ seat billing for collaboration-focused workflows

Until the billing implementation is fully consolidated, public docs should describe the simpler **Free / Paid / Enterprise** model while being careful not to imply that every internal label has already been renamed.

## Messaging Guidance

When describing Cullit publicly:

1. Lead with **Free to try**
2. Position **Paid** as the default production plan
3. Describe collaboration, org keys, approvals, and governance as part of paid team usage
4. Reserve **Enterprise** for SSO, procurement, and support-heavy deals

## Internal Billing Notes

These legacy env vars remain in use until checkout is consolidated:

- `STRIPE_PRO_PRICE_ID`
- `STRIPE_PRO_ANNUAL_PRICE_ID`
- `STRIPE_TEAM_PRICE_ID`
- `STRIPE_TEAM_ANNUAL_PRICE_ID`
