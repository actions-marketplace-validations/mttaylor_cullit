/**
 * GitHub REST API helpers for the Cullit GitHub App.
 *
 * Handles installation token caching, app JWT minting, release CRUD,
 * tag lookup, repo cloning, and "shipped in <tag>" PR/issue commenting.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VERSION } from '@cullit/core';
import { log } from './logger.js';
import { APP_ID, PRIVATE_KEY } from './config.js';
import { base64url } from './util.js';

interface InstallationToken {
  token: string;
  expiresAt: number;
}

const TOKEN_CACHE_MAX = 1000;
const tokenCache = new Map<number, InstallationToken>();

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const jwt = await createJWT();
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': `cullit-app/${VERSION}`,
    },
  });

  if (!res.ok) throw new Error(`Failed to get installation token: ${res.status}`);
  const data = await res.json() as { token: string; expires_at: string };

  // Evict expired entries and enforce max size
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const now = Date.now();
    for (const [id, entry] of tokenCache) {
      if (entry.expiresAt <= now) tokenCache.delete(id);
    }
    if (tokenCache.size >= TOKEN_CACHE_MAX) {
      const firstKey = tokenCache.keys().next().value;
      if (firstKey !== undefined) tokenCache.delete(firstKey);
    }
  }

  tokenCache.set(installationId, {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  });

  return data.token;
}

export async function createJWT(): Promise<string> {
  if (!APP_ID || !PRIVATE_KEY) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY required');

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ iss: APP_ID, iat: now - 60, exp: now + 600 }));

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = base64url(sign.sign(PRIVATE_KEY));

  return `${header}.${payload}.${signature}`;
}

export async function createOrUpdateRelease(
  token: string, owner: string, repo: string,
  tag: string, body: string,
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': `cullit-app/${VERSION}`,
  };

  const existing = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
    { headers },
  );

  if (existing.ok) {
    const release = await existing.json() as { id: number };
    await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    });
    log.info({ tag, owner, repo }, 'Updated release');
  } else {
    await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tag_name: tag, name: tag, body }),
    });
    log.info({ tag, owner, repo }, 'Created release');
  }
}

export async function getPreviousTag(token: string, owner: string, repo: string, currentTag: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/tags?per_page=10`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': `cullit-app/${VERSION}`,
      },
    },
  );

  if (!res.ok) return null;
  const tags = await res.json() as { name: string }[];
  const idx = tags.findIndex(t => t.name === currentTag);
  return idx >= 0 && idx + 1 < tags.length ? tags[idx + 1].name : null;
}

/**
 * Shallow-clone a repo into a temp directory using a token-protected askpass.
 * Caller is responsible for `rmSync(dir, { recursive: true })`.
 */
export function cloneRepo(owner: string, repo: string, token: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'cullit-app-'));
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const askPassScript = join(tempDir, '.git-askpass');
  writeFileSync(askPassScript, `#!/bin/sh\necho "${token}"`, { mode: 0o700 });
  execFileSync('git', ['clone', '--depth=500', '--single-branch', cloneUrl, tempDir], {
    encoding: 'utf-8',
    timeout: 120_000,
    stdio: 'pipe',
    env: { ...process.env, GIT_ASKPASS: askPassScript, GIT_TERMINAL_PROMPT: '0' },
  });
  return tempDir;
}

/**
 * Find merged PRs between two tags and comment "Shipped in <tag>" on each.
 * Also comments on any linked issues (Fixes #N, Closes #N) found in PR bodies.
 */
export async function commentOnShippedPRs(
  token: string, owner: string, repo: string,
  fromTag: string, toTag: string,
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': `cullit-app/${VERSION}`,
  };

  const compareRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(fromTag)}...${encodeURIComponent(toTag)}?per_page=100`,
    { headers },
  );
  if (!compareRes.ok) {
    log.warn({ status: compareRes.status, fromTag, toTag }, 'Compare API failed');
    return;
  }
  const compareData = await compareRes.json() as {
    commits: Array<{ sha: string }>;
  };

  const commentedPRs = new Set<number>();
  const commentedIssues = new Set<number>();
  const comment = `🚀 Shipped in [${toTag}](https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(toTag)})`;

  for (const commit of compareData.commits) {
    const prRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${commit.sha}/pulls`,
      { headers },
    );
    if (!prRes.ok) continue;
    const prs = await prRes.json() as Array<{ number: number; body: string | null; merged_at: string | null }>;

    for (const pr of prs) {
      if (!pr.merged_at || commentedPRs.has(pr.number)) continue;
      commentedPRs.add(pr.number);

      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/comments`,
        { method: 'POST', headers, body: JSON.stringify({ body: comment }) },
      );

      if (pr.body) {
        const issuePattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
        let match: RegExpExecArray | null;
        while ((match = issuePattern.exec(pr.body)) !== null) {
          const issueNum = parseInt(match[1], 10);
          if (commentedIssues.has(issueNum)) continue;
          commentedIssues.add(issueNum);

          await fetch(
            `https://api.github.com/repos/${owner}/${repo}/issues/${issueNum}/comments`,
            { method: 'POST', headers, body: JSON.stringify({ body: comment }) },
          );
        }
      }
    }
  }

  log.info({ owner, repo, toTag, prs: commentedPRs.size, issues: commentedIssues.size }, 'Commented on shipped PRs/issues');
}
