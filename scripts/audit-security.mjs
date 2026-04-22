#!/usr/bin/env node
/**
 * Security audit script for cullit.
 * Checks that known security guards and hardening patterns remain in place.
 * Run via: pnpm audit:security
 */
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    fail(`Unable to read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

function check(label, ok) {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✗\x1b[0m ${label}`);
  }
}

function has(text, pattern) {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

// ---------------------------------------------------------------------------
// Load source files
// ---------------------------------------------------------------------------
const authTs     = read('packages/api/src/auth.ts');
const orgTs      = read('packages/api/src/routes/org.ts');
const draftsTs   = read('packages/api/src/routes/drafts.ts');
const billingTs  = read('packages/api/src/billing.ts');
const dbTs       = read('packages/api/src/db.ts');
const indexTs    = read('packages/api/src/index.ts');
const jiraTs     = read('packages/pro/src/collectors/jira.ts');

// ---------------------------------------------------------------------------
// #1  Org creation limit
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mOrg creation limit\x1b[0m');
check('MAX_ORGS_PER_USER constant exists', has(orgTs, 'MAX_ORGS_PER_USER'));
check('Org count checked before creation', has(orgTs, 'dbGetOrgCountForOwner'));
check('409 returned when limit reached', has(orgTs, /ownedCount\s*>=\s*MAX_ORGS_PER_USER/));

// ---------------------------------------------------------------------------
// #6  JQL injection hardening
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mJQL injection hardening\x1b[0m');
check('sanitizeJQL rejects semicolons/comments', has(jiraTs, /\[;{}\]/));
check('JQL length limit (1000)', has(jiraTs, 'jql.length > 1000'));
check('JQL allowlist regex excludes * and /', !has(jiraTs, /allowedPattern.*[*]/) || has(jiraTs, /\^\[\\w/));
check('Advanced JQL functions blocked', has(jiraTs, 'issueFunction'));

// ---------------------------------------------------------------------------
// #7  Draft optimistic locking
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mDraft optimistic locking\x1b[0m');
check('dbUpdateDraft accepts expectedUpdatedAt', has(dbTs, 'expectedUpdatedAt?: string'));
check('SQL uses AND updated_at condition', has(dbTs, /AND updated_at\s*=\s*\$\{expectedUpdatedAt\}/));
check('409 DRAFT_CONFLICT response', has(draftsTs, 'DRAFT_CONFLICT'));

// ---------------------------------------------------------------------------
// #8  OAuth state pruning safety
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mOAuth state pruning safety\x1b[0m');
check('Pruning interval wrapped in try/catch', has(authTs, /setInterval\(\(\)\s*=>\s*\{\s*try\s*\{/));
check('Capacity warning at 90%', has(authTs, /pendingStates\.size\s*>\s*MAX_PENDING_STATES\s*\*\s*0\.9/));
check('Error logged on pruning failure', has(authTs, 'OAuth state pruning failed'));

// ---------------------------------------------------------------------------
// #10  Invite velocity rate limit
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mInvite velocity rate limit\x1b[0m');
check('INVITE_RATE_MAX defined', has(orgTs, 'INVITE_RATE_MAX'));
check('INVITE_RATE_WINDOW defined', has(orgTs, 'INVITE_RATE_WINDOW'));
check('429 returned on rate limit', has(orgTs, /Too many invites sent recently/));

// ---------------------------------------------------------------------------
// #11  Orphaned orgs on account delete
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mOrphaned orgs on account delete\x1b[0m');
check('dbGetOrgsOwnedByUser imported in auth', has(authTs, 'dbGetOrgsOwnedByUser'));
check('All owned orgs checked before delete', has(authTs, /ownedOrgs\s*=\s*await\s+dbGetOrgsOwnedByUser/));
check('409 blocks delete when orgs exist', has(authTs, /Transfer ownership or delete them/));

// ---------------------------------------------------------------------------
// #12  CORS wildcard blocked in production
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mCORS wildcard blocked in production\x1b[0m');
check('ALLOWED_ORIGINS validated', has(indexTs, "ALLOWED_ORIGINS === '*'"));
check('Throws on wildcard', has(indexTs, /Wildcard\s*\(\*\)\s*is not allowed/));

// ---------------------------------------------------------------------------
// #14  maxSeats bounded
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mmaxSeats bounded\x1b[0m');
check('updateOrgMaxSeats clamps value', has(authTs, /Math\.max\(1,\s*Math\.min\(maxSeats,\s*1000\)\)/));

// ---------------------------------------------------------------------------
// #15  Seat count metadata validation
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mSeat count metadata validation\x1b[0m');
check('Warns when seat metadata missing', has(billingTs, /Checkout metadata missing seat count/));

// ---------------------------------------------------------------------------
// #16  Draft version trimmed
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mDraft version trimmed\x1b[0m');
check('Version string trimmed on create', has(draftsTs, ".trim().slice(0, 64)"));

// ---------------------------------------------------------------------------
// #17  Slug empty-string fallback
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mSlug empty-string fallback\x1b[0m');
check('Slug strips leading/trailing hyphens', has(authTs, /replace\(\/\^-\+\|-\+\$\/g/));
check('Empty slug gets random fallback', has(authTs, "if (!slug) slug = `org-${randomBytes(4)"));

// ---------------------------------------------------------------------------
// DB helpers exist
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mDB helpers\x1b[0m');
check('dbGetOrgCountForOwner exists', has(dbTs, 'async function dbGetOrgCountForOwner'));
check('dbGetOrgsOwnedByUser exists', has(dbTs, 'async function dbGetOrgsOwnedByUser'));
check('delete_user_cascade stored procedure', has(dbTs, 'delete_user_cascade'));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const total = passed + failed;
console.log(`\n\x1b[1m${passed}/${total} checks passed\x1b[0m`);
if (failed > 0) {
  console.error(`\x1b[31m${failed} check(s) FAILED — security guards may have been removed.\x1b[0m\n`);
  process.exitCode = 1;
} else {
  console.log('\x1b[32mAll security guards intact.\x1b[0m\n');
}
