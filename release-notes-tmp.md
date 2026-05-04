# Cullit v2.10.1 — Open Source Sponsorship Transition

This release finalizes Cullit's move to a fully free and open-source model.

## Highlights

### Billing and plan retirement

- Checkout and portal flows are retired.
- Billing API routes now return compatibility responses with sponsor guidance.
- Dashboard plan messaging is shifted to open-source support language.

### Open-access runtime behavior

- Feature gating is now permissive across CLI, API, and dashboard workflows.
- Legacy tier values are still accepted for compatibility in persisted data.
- Existing analytics and history payload structures are preserved.

### Documentation and legal alignment

- Architecture, database, legal, and support pages now describe the sponsorship model.
- Pricing content now points to GitHub Sponsors rather than paid plans.

## Upgrade

```bash
npm install -g @cullit/cli@2.10.1
```

No migration steps are required for existing users.
