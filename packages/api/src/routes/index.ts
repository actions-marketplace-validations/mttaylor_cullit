/**
 * Route table — declarative HTTP method/path → handler mapping.
 *
 * Handlers are imported from per-domain route modules. The main router
 * in index.ts walks this table in order and dispatches the first match.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import {
  handleAuthRedirect, handleAuthCallback, handleAuthMe, handleAuthLogout,
  handleRotateApiKey, handleDeleteAccount, handleExportAccount,
  handleLicenseValidate, handleUpdateMe,
} from '../auth.js';
import { handleDocs } from '../docs.js';
import { handleMetrics } from '../metrics.js';
import { json } from '../utils.js';

import {
  handleHealth, handleOpenAPI, handleTrackEvent,
  handleChangelogLatestRoute, handleChangelogDeleteRoute,
} from './system.js';
import { handleGenerate } from './generate.js';
import { handleGetHistory, handleGetAnalytics } from './analytics.js';
import {
  handleGetAuditLog,
  handleListTemplates, handleCreateTemplate, handleDeleteTemplate,
} from './audit-templates.js';
import {
  handleAppInstallation, handleGitHubInstallations, handleGitHubDisconnect,
} from './github-app.js';
import {
  handleCheckoutRoute, handleBillingPortalRoute,
  handleGetSubscriptionRoute, handleStripeWebhookRoute,
} from './billing.js';
import {
  handleGetProjectSettings, handlePutProjectSettings,
} from './project-settings.js';
import {
  handleChangelogPublish, handleChangelogListProjects,
} from './changelog.js';
import { handleIntegrationsTest } from './integrations.js';
import {
  handleCreateDraft, handleListDrafts, handleGetDraft, handleUpdateDraft,
  handleDraftSubmit, handleDeleteDraft, handleDraftApprove, handleDraftPublish,
} from './drafts.js';
import {
  handleGetOrg, handleCreateOrg, handleOrgInvite, handleOrgRemoveMember,
  handleCreateOrgInvite, handleListOrgInvites, handleDeleteOrgInvite, handleAcceptOrgInvite,
  handleUpdateOrgMemberRole, handleGetOrgUsage, handleUpdateOrgSettings,
} from './org.js';
import {
  handleListTeamKeys, handleUpdateTeamKey, handleSendTeamKey,
  handleRevokeTeamKey, handleRotateTeamKey, handleReplaceTeamKey,
} from './team-keys.js';

export type Route = {
  method: string;
  path: string | RegExp;
  handler: (req: IncomingMessage, res: ServerResponse, ...params: string[]) => Promise<void> | void;
  rateLimit?: boolean;
};

export const routes: Route[] = [
  // Auth
  { method: 'GET',    path: '/auth/login',            handler: (req, res) => handleAuthRedirect(req, res) },
  { method: 'GET',    path: '/auth/callback',          handler: handleAuthCallback },
  { method: 'GET',    path: '/auth/me',                handler: (req, res) => handleAuthMe(req, res, json) },
  { method: 'PATCH',  path: '/auth/me',                handler: (req, res) => handleUpdateMe(req, res, json) },
  { method: 'POST',   path: '/auth/logout',            handler: (req, res) => handleAuthLogout(req, res, json) },
  { method: 'POST',   path: '/auth/rotate-key',        handler: (req, res) => handleRotateApiKey(req, res, json) },
  { method: 'GET',    path: '/auth/me/export',         handler: (req, res) => handleExportAccount(req, res, json) },
  { method: 'DELETE', path: '/auth/me',                handler: (req, res) => handleDeleteAccount(req, res, json) },

  // License & App
  { method: 'POST',   path: '/v1/license/validate',    handler: (req, res) => handleLicenseValidate(req, res, json) },
  { method: 'POST',   path: '/v1/app/installation',    handler: handleAppInstallation },

  // System (no rate limit)
  { method: 'GET',    path: '/health',                 handler: handleHealth,   rateLimit: false },
  { method: 'HEAD',   path: '/health',                 handler: handleHealth,   rateLimit: false },
  { method: 'GET',    path: '/healthz',                handler: handleHealth,   rateLimit: false },
  { method: 'HEAD',   path: '/healthz',                handler: handleHealth,   rateLimit: false },
  { method: 'GET',    path: '/openapi.json',           handler: handleOpenAPI,  rateLimit: false },
  { method: 'GET',    path: '/v1/docs',                handler: (req, res) => handleDocs(req, res) },
  { method: 'GET',    path: '/docs',                   handler: (req, res) => handleDocs(req, res) },
  { method: 'GET',    path: '/metrics',                handler: handleMetrics,  rateLimit: false },
  { method: 'POST',   path: '/v1/events',              handler: handleTrackEvent, rateLimit: true },

  // Generate
  { method: 'POST',   path: '/generate',               handler: handleGenerate },
  { method: 'POST',   path: '/v1/generate',            handler: handleGenerate },

  // Changelog
  { method: 'POST',   path: '/v1/changelog',           handler: handleChangelogPublish },
  { method: 'POST',   path: '/v1/integrations/test',   handler: handleIntegrationsTest, rateLimit: true },
  { method: 'GET',    path: /^\/v1\/changelog\/([a-zA-Z0-9_-]{1,64})\/latest$/, handler: (req, res, project) => handleChangelogLatestRoute(req, res, project) },
  { method: 'GET',    path: '/v1/changelog/projects',  handler: handleChangelogListProjects },
  { method: 'DELETE', path: /^\/v1\/changelog\/([a-zA-Z0-9_-]{1,64})\/(.+)$/, handler: (req, res, project, version) => handleChangelogDeleteRoute(req, res, project, version) },

  // Billing
  { method: 'POST',   path: '/v1/billing/checkout',     handler: handleCheckoutRoute },
  { method: 'POST',   path: '/v1/billing/portal',       handler: handleBillingPortalRoute },
  { method: 'GET',    path: '/v1/billing/subscription',  handler: handleGetSubscriptionRoute },
  { method: 'POST',   path: '/v1/billing/webhook',      handler: handleStripeWebhookRoute, rateLimit: false },

  // GitHub App user-facing
  { method: 'GET',    path: '/v1/github/installations', handler: handleGitHubInstallations },
  { method: 'POST',   path: '/v1/github/disconnect',    handler: handleGitHubDisconnect },

  // Team / Org
  { method: 'GET',    path: '/v1/org',                  handler: handleGetOrg },
  { method: 'POST',   path: '/v1/org',                  handler: handleCreateOrg },
  { method: 'PATCH',  path: '/v1/org/settings',         handler: handleUpdateOrgSettings },
  { method: 'POST',   path: '/v1/org/invite',           handler: handleOrgInvite },
  { method: 'DELETE', path: '/v1/org/members',          handler: handleOrgRemoveMember },

  // Draft workflow
  { method: 'POST',   path: '/v1/drafts',               handler: handleCreateDraft },
  { method: 'GET',    path: '/v1/drafts',               handler: handleListDrafts },
  { method: 'GET',    path: /^\/v1\/drafts\/([^/]+)$/,  handler: (req, res, id) => handleGetDraft(req, res, id) },
  { method: 'PATCH',  path: /^\/v1\/drafts\/([^/]+)$/,  handler: (req, res, id) => handleUpdateDraft(req, res, id) },
  { method: 'DELETE', path: /^\/v1\/drafts\/([^/]+)$/,  handler: (req, res, id) => handleDeleteDraft(req, res, id) },
  { method: 'POST',   path: /^\/v1\/drafts\/([^/]+)\/submit$/,  handler: (req, res, id) => handleDraftSubmit(req, res, id) },
  { method: 'POST',   path: /^\/v1\/drafts\/([^/]+)\/approve$/, handler: (req, res, id) => handleDraftApprove(req, res, id) },
  { method: 'POST',   path: /^\/v1\/drafts\/([^/]+)\/publish$/, handler: (req, res, id) => handleDraftPublish(req, res, id) },

  // Project settings
  { method: 'GET',    path: '/v1/projects/settings',    handler: handleGetProjectSettings },
  { method: 'PUT',    path: /^\/v1\/projects\/([^/]+)\/settings$/, handler: (req, res, project) => handlePutProjectSettings(req, res, project) },

  // Org invites
  { method: 'POST',   path: '/v1/org/invites',          handler: handleCreateOrgInvite },
  { method: 'GET',    path: '/v1/org/invites',          handler: handleListOrgInvites },
  { method: 'DELETE', path: /^\/v1\/org\/invites\/([^/]+)$/,        handler: (req, res, id) => handleDeleteOrgInvite(req, res, id) },
  { method: 'POST',   path: /^\/v1\/org\/invites\/([^/]+)\/accept$/, handler: (req, res, token) => handleAcceptOrgInvite(req, res, token) },
  { method: 'PATCH',  path: /^\/v1\/org\/members\/([^/]+)$/,        handler: (req, res, id) => handleUpdateOrgMemberRole(req, res, id) },
  { method: 'GET',    path: '/v1/org/usage',            handler: handleGetOrgUsage },

  // Team API keys
  { method: 'GET',    path: '/v1/org/keys',             handler: handleListTeamKeys },
  { method: 'PATCH',  path: /^\/v1\/org\/keys\/([^/]+)$/,          handler: (req, res, id) => handleUpdateTeamKey(req, res, id) },
  { method: 'POST',   path: /^\/v1\/org\/keys\/([^/]+)\/send$/,    handler: (req, res, id) => handleSendTeamKey(req, res, id) },
  { method: 'POST',   path: /^\/v1\/org\/keys\/([^/]+)\/revoke$/,  handler: (req, res, id) => handleRevokeTeamKey(req, res, id) },
  { method: 'POST',   path: /^\/v1\/org\/keys\/([^/]+)\/rotate$/,  handler: (req, res, id) => handleRotateTeamKey(req, res, id) },
  { method: 'POST',   path: /^\/v1\/org\/keys\/([^/]+)\/replace$/, handler: (req, res, id) => handleReplaceTeamKey(req, res, id) },

  // History & Analytics
  { method: 'GET',    path: '/v1/history',              handler: handleGetHistory },
  { method: 'GET',    path: '/v1/analytics/usage',      handler: handleGetAnalytics },

  // Audit Log
  { method: 'GET',    path: '/v1/audit',                handler: handleGetAuditLog },

  // Project Templates
  { method: 'GET',    path: '/v1/templates',            handler: handleListTemplates },
  { method: 'POST',   path: '/v1/templates',            handler: handleCreateTemplate },
  { method: 'DELETE', path: /^\/v1\/templates\/([^/]+)$/, handler: (req, res, id) => handleDeleteTemplate(req, res, id) },
];
