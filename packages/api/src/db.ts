/**
 * Backwards-compatible barrel for the database module.
 *
 * The implementation lives in `db/*.ts`, split by domain
 * (users, orgs, subscriptions, webhooks, tokens, oauth,
 *  email-throttle, audit, templates, generations, changelog,
 *  drafts, project-settings, team-keys, retention).
 *
 * Existing imports `from './db.js'` keep working via this re-export.
 */
export * from './db/index.js';