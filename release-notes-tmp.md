## v2.9.2 — Deep Security Audit Hardening

Comprehensive security fixes from a second 7-agent deep-dive audit across the entire codebase.

### Security Fixes (10)

- **Team key privilege escalation** — Block team API keys from editing/deleting owner drafts via user ID match
- **Path traversal in returnTo** — Block `/../` sequences in OAuth redirect
- **Email header injection** — Reject emails containing control characters in org invite flow
- **CORS cache poisoning** — Add `Vary: Origin` header to all CORS responses
- **Stripe portal URL protocol** — Validate `https:` protocol before redirecting to billing portal
- **Avatar URL validation** — Only allow `http://` or `https://` protocols for avatar URLs
- **SSRF hardening** — Block IPv6 mapped addresses, link-local, shared address space
- **Prompt injection mitigation** — Sanitize commit messages before AI prompt embedding
- **Git ref validation** — Remove caret from allowed ref characters
- **Rate limiting** — Add rate limiting to `/v1/events` endpoint + cap categories array to 50 items

### Database Improvements (4)

- Add full `org_id` index on `team_api_keys` (non-partial)
- Add `user_id` index on `org_members` for JOIN performance
- Add `project` index on `generations` for project-based queries
- Add `LIMIT 500` to org members query

### Infrastructure

- Add `HEALTHCHECK` instruction to Dockerfile

### Stats

- **654 tests passing** across 51 test files
- **15 findings fixed**, 1 resolved as false positive
- **0 breaking changes**
