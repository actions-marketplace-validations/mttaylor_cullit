/**
 * Database module barrel — re-exports all DB operations from domain modules.
 *
 * Domain split:
 *   client          — connection pool, sql tag, hashApiKey, migrate, closeDb
 *   users           — user CRUD, GDPR export/delete
 *   orgs            — orgs, members, invites
 *   subscriptions   — Stripe billing state
 *   webhooks        — Stripe webhook idempotency
 *   tokens          — JWT revocation
 *   oauth           — OAuth state CSRF tokens
 *   email-throttle  — per-recipient throttle
 *   audit           — audit event log
 *   templates       — project templates (org-scoped)
 *   generations     — generation history + usage analytics
 *   changelog       — published changelog releases
 *   drafts          — release drafts + revisions
 *   project-settings — per-project default config
 *   team-keys       — seat-based team API keys
 *   retention       — daily data-retention sweep
 */

export { sql, hashApiKey, migrate, closeDb } from './client.js';
export type { DbUser } from './users.js';
export {
  dbGetUser, dbGetUserByApiKey, dbGetUserByStripeCustomer,
  dbGetUserByLogin, dbGetUserByGithubUsername, dbUpdateGithubUsername,
  dbUpsertUser, dbUpdateUserTier, dbUpdateUserOrg, dbUpdateUserStripe,
  dbRotateApiKey, dbUpdatePreferredProvider,
  dbDeleteUser, dbExportUserData,
} from './users.js';
export type { DbOrg, DbOrgInvite } from './orgs.js';
export {
  dbGetOrg, dbGetOrgBySlug, dbGetOrgCountForOwner, dbGetOrgsOwnedByUser,
  dbCreateOrg, dbUpdateOrgSettings, dbUpdateOrgMaxSeats,
  dbGetOrgMemberCount, dbAddOrgMember, dbAddOrgMemberAtomic,
  dbRemoveOrgMember, dbGetOrgMembers, dbUpdateOrgMemberRole,
  dbCreateOrgInvite, dbListOrgInvites, dbGetOrgInviteByToken,
  dbAcceptOrgInvite, dbDeleteOrgInvite,
} from './orgs.js';
export { dbUpsertSubscription, dbGetSubscription } from './subscriptions.js';
export {
  dbCheckWebhookProcessed, dbMarkWebhookProcessed, dbUnmarkWebhookProcessed,
} from './webhooks.js';
export {
  dbRevokeToken, dbIsTokenRevoked, dbRevokeAllUserTokens, dbGetTokensRevokedBefore,
} from './tokens.js';
export { dbCreateOAuthState, dbConsumeOAuthState } from './oauth.js';
export { dbCountRecentEmails, dbRecordEmailSent } from './email-throttle.js';
export { dbRecordAuditEvent, dbGetAuditEvents } from './audit.js';
export type { DbProjectTemplate } from './templates.js';
export {
  dbCreateProjectTemplate, dbListProjectTemplates,
  dbGetProjectTemplate, dbDeleteProjectTemplate,
} from './templates.js';
export {
  dbAddGeneration, dbGetGenerations, dbGetGenerationCount, dbGetMonthlyGenerationCount,
  dbRecordUsage, dbGetUsageStats,
} from './generations.js';
export {
  dbGetProjectOwner, dbPublishRelease, dbGetReleases,
  dbGetProjectCount, dbGetUserProjectCount, dbDeleteRelease, dbGetUserProjects,
} from './changelog.js';
export type { DraftStatus, DbDraft, DbRevision } from './drafts.js';
export {
  dbPublishDraftWithRelease,
  dbCreateDraft, dbGetDraft, dbListDrafts, dbUpdateDraft, dbUpdateDraftStatus, dbDeleteDraft,
  dbCreateRevision, dbGetRevisions, dbGetRevisionCount,
} from './drafts.js';
export type { DbProjectSettings } from './project-settings.js';
export {
  dbGetProjectSettings, dbUpsertProjectSettings, dbListProjectSettings,
} from './project-settings.js';
export type { DbTeamApiKey } from './team-keys.js';
export {
  dbCreateTeamApiKey, dbGetTeamApiKeys, dbGetActiveTeamApiKeyCount,
  dbGetTeamApiKeyByKey, dbUpdateTeamApiKeyAssignment, dbUpdateTeamApiKeyLabel,
  dbRevokeTeamApiKey, dbRevokeAllOrgTeamApiKeys, dbRevokeExcessTeamApiKeys,
  dbRotateTeamApiKey,
} from './team-keys.js';
export { dbRunRetentionCleanup } from './retention.js';
