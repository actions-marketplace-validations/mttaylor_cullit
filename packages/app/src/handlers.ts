/**
 * Webhook event handlers for the Cullit GitHub App.
 *
 * Each handler corresponds to a single GitHub event type and runs
 * in the background after the webhook endpoint has 200'd.
 */
import { rmSync } from 'fs';
import { runPipeline, VERSION, DEFAULT_CATEGORIES } from '@cullit/core';
import type { CullConfig, PublishTarget } from '@cullit/core';
import { log } from './logger.js';
import {
  AI_PROVIDER, AI_MODEL, AI_API_KEY,
  SLACK_WEBHOOK, DISCORD_WEBHOOK, TEAMS_WEBHOOK, CHANGELOG_ENABLED,
  CULLIT_API_URL, CULLIT_APP_SECRET,
} from './config.js';
import {
  getInstallationToken, getPreviousTag, cloneRepo,
  createOrUpdateRelease, commentOnShippedPRs,
} from './github-api.js';
import { metrics } from './metrics.js';

interface GitHubRepositoryPayload {
  name: string;
  owner: { login: string };
}

interface GitHubInstallationPayload {
  id: number;
  account?: { login?: string };
}

export interface GitHubReleasePayload {
  action?: string;
  release?: { tag_name?: string };
  repository?: GitHubRepositoryPayload;
  installation?: GitHubInstallationPayload;
}

export interface GitHubPushPayload {
  ref?: string;
  repository?: GitHubRepositoryPayload;
  installation?: GitHubInstallationPayload;
}

export interface GitHubInstallationEventPayload {
  action?: string;
  installation?: GitHubInstallationPayload;
  repositories?: Array<{ full_name?: string }>;
}

function buildPublishTargets(): PublishTarget[] {
  const targets: PublishTarget[] = [];
  if (SLACK_WEBHOOK) targets.push({ type: 'slack', webhookUrl: SLACK_WEBHOOK });
  if (DISCORD_WEBHOOK) targets.push({ type: 'discord', webhookUrl: DISCORD_WEBHOOK });
  if (TEAMS_WEBHOOK) targets.push({ type: 'teams', webhookUrl: TEAMS_WEBHOOK });
  if (CHANGELOG_ENABLED) targets.push({ type: 'changelog' });
  return targets;
}

export async function handleRelease(payload: GitHubReleasePayload): Promise<void> {
  const { release, repository, installation } = payload;
  if (!release || !repository || !installation) return;

  const action = payload.action;
  if (action !== 'published' && action !== 'created') return;

  const tag = release.tag_name;
  const owner = repository.owner.login;
  const repo = repository.name;
  const installationId = installation.id;

  log.info({ action, owner, repo, tag }, 'Processing release event');

  const token = await getInstallationToken(installationId);
  const prevTag = await getPreviousTag(token, owner, repo, tag);

  if (!prevTag) {
    log.info({ tag }, 'No previous tag found, skipping');
    return;
  }

  let repoDir: string | undefined;
  try {
    repoDir = cloneRepo(owner, repo, token);

    const config: CullConfig = {
      ai: { provider: AI_PROVIDER, model: AI_MODEL, apiKey: AI_API_KEY, audience: 'developer', tone: 'professional', categories: DEFAULT_CATEGORIES },
      source: { type: 'local', repoPath: repoDir },
      publish: buildPublishTargets(),
    };

    const result = await runPipeline(prevTag, tag, config, { format: 'markdown' });
    await createOrUpdateRelease(token, owner, repo, tag, result.formatted);

    await commentOnShippedPRs(token, owner, repo, prevTag, tag).catch(err => {
      log.warn({ err: (err as Error).message, tag }, 'PR/issue commenting failed (non-fatal)');
    });
  } finally {
    if (repoDir) try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

export async function handlePush(payload: GitHubPushPayload): Promise<void> {
  const { ref, repository, installation } = payload;
  if (!ref || !repository || !installation) return;

  if (!ref.startsWith('refs/tags/')) return;

  const tag = ref.replace('refs/tags/', '');
  const owner = repository.owner.login;
  const repo = repository.name;
  const installationId = installation.id;

  log.info({ owner, repo, tag }, 'Processing tag push');

  const token = await getInstallationToken(installationId);
  const prevTag = await getPreviousTag(token, owner, repo, tag);

  if (!prevTag) {
    log.info({ tag }, 'No previous tag found, skipping');
    return;
  }

  let repoDir: string | undefined;
  try {
    repoDir = cloneRepo(owner, repo, token);

    const config: CullConfig = {
      ai: { provider: AI_PROVIDER, model: AI_MODEL, apiKey: AI_API_KEY, audience: 'developer', tone: 'professional', categories: DEFAULT_CATEGORIES },
      source: { type: 'local', repoPath: repoDir },
      publish: buildPublishTargets(),
    };

    const result = await runPipeline(prevTag, tag, config, { format: 'markdown' });
    await createOrUpdateRelease(token, owner, repo, tag, result.formatted);
  } finally {
    if (repoDir) try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

export function handleInstallation(payload: GitHubInstallationEventPayload): void {
  const action = payload.action;
  const account = payload.installation?.account?.login || 'unknown';
  const repos = payload.repositories?.map(r => r.full_name || '').filter(Boolean) || [];

  log.info({ action, account, repoCount: repos.length }, 'Installation event');
  metrics.installations++;

  if (action === 'created') {
    log.info({ repos }, 'Installed repos');
    if (CULLIT_API_URL && CULLIT_APP_SECRET) {
      linkInstallation(payload.installation?.id, account, repos).catch(err => {
        log.warn(
          { err: (err as Error).message, account },
          'Failed to auto-link installation — user can configure repos manually in the dashboard',
        );
      });
    } else {
      log.warn(
        { account, installationId: payload.installation?.id },
        'CULLIT_API_URL or CULLIT_APP_SECRET not set — skipping auto-link. ' +
        'User must configure repos manually in the dashboard.',
      );
    }
  }
}

/**
 * Notify the Cullit API that a GitHub App installation was created.
 * The API matches the GitHub login to a Cullit user and stores the installation mapping.
 */
async function linkInstallation(
  installationId: number | undefined,
  githubLogin: string,
  repos: string[],
): Promise<void> {
  if (!installationId) return;

  const res = await fetch(`${CULLIT_API_URL}/v1/app/installation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CULLIT_APP_SECRET}`,
      'User-Agent': `cullit-app/${VERSION}`,
    },
    body: JSON.stringify({ installationId, githubLogin, repos }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API responded ${res.status}: ${body.slice(0, 200)}`);
  }

  log.info({ installationId, githubLogin, repoCount: repos.length }, 'Installation linked via API');
}
