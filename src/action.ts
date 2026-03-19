/**
 * GitHub Action entry point for Cullit.
 * Reads inputs from environment, runs the pipeline, and sets outputs.
 * 
 * This file is bundled to dist/index.js via:
 *   pnpm build:action
 */

import { runPipeline, getRecentTags } from '@cullit/core';
import { loadConfig } from '@cullit/config';
import type { CullConfig, OutputFormat, AIProvider, Audience, Tone, PublishTarget } from '@cullit/core';
import { DEFAULT_CATEGORIES } from '@cullit/core';
import { appendFileSync } from 'fs';
import { resolveActionRefs } from './action-refs';

let proPluginsLoaded = false;

async function loadProPlugins(): Promise<void> {
  if (proPluginsLoaded) return;
  try {
    await import('@cullit/pro');
  } catch {
    // Pro features are optional in local/test environments.
  }
  proPluginsLoaded = true;
}

// --- GitHub Actions helpers (no @actions/core dependency) ---

function getInput(name: string): string {
  return (process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] || '').trim();
}

function setOutput(name: string, value: string): void {
  const outputFile = process.env['GITHUB_OUTPUT'];
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

function setFailed(message: string): void {
  console.log(`::error::${message}`);
  process.exitCode = 1;
}

// --- Main ---

export async function run(): Promise<void> {
  try {
    await loadProPlugins();

    // Read inputs
    const inputFrom = getInput('from');
    const inputTo = getInput('to') || 'HEAD';
    const configPath = getInput('config');
    const provider = (getInput('provider') || 'none') as AIProvider;
    const model = getInput('model');
    const audience = (getInput('audience') || 'developer') as Audience;
    const tone = (getInput('tone') || 'professional') as Tone;
    const format = (getInput('format') || 'markdown') as OutputFormat;
    const slackWebhook = getInput('publish-slack-webhook');
    const discordWebhook = getInput('publish-discord-webhook');
    const githubRelease = getInput('publish-github-release') === 'true';
    const teamsWebhook = getInput('publish-teams-webhook');
    const publishConfluence = getInput('publish-confluence') === 'true';
    const publishNotion = getInput('publish-notion') === 'true';
    const publishGitlabRelease = getInput('publish-gitlab-release') === 'true';
    const publishChangelog = getInput('publish-changelog') === 'true';
    const jiraDomain = getInput('jira-domain');
    const source = getInput('source') || 'local';

    const { from, to, autoDetected } = resolveActionRefs(
      inputFrom,
      inputTo,
      inputFrom ? [] : getRecentTags()
    );
    if (autoDetected) {
      console.log(`» Auto-detected start ref: ${from} → ${to}`);
    }

    // Set API key from input if provided (env var takes precedence)
    const apiKey = getInput('api-key');
    if (apiKey && !process.env.CULLIT_API_KEY) {
      process.env.CULLIT_API_KEY = apiKey;
    }

    // Build config
    let config: CullConfig;

    if (configPath) {
      config = loadConfig(configPath);
    } else {
      const publishers: PublishTarget[] = [{ type: 'stdout' }];

      if (slackWebhook) {
        publishers.push({ type: 'slack', webhookUrl: slackWebhook });
      }
      if (discordWebhook) {
        publishers.push({ type: 'discord', webhookUrl: discordWebhook });
      }
      if (githubRelease) {
        publishers.push({ type: 'github-release' });
      }
      if (teamsWebhook) {
        publishers.push({ type: 'teams', webhookUrl: teamsWebhook });
      }
      if (publishConfluence) {
        publishers.push({ type: 'confluence' });
      }
      if (publishNotion) {
        publishers.push({ type: 'notion' });
      }
      if (publishGitlabRelease) {
        publishers.push({ type: 'gitlab-release' });
      }
      if (publishChangelog) {
        publishers.push({ type: 'changelog' });
      }

      config = {
        ai: {
          provider,
          model: model || undefined,
          audience,
          tone,
          categories: DEFAULT_CATEGORIES,
        },
        source: {
          type: source,
          enrichment: jiraDomain ? ['jira'] : [],
        },
        publish: publishers,
        ...(jiraDomain ? { jira: { domain: jiraDomain } } : {}),
      };
    }

    // Override with explicit inputs
    if (provider) config.ai.provider = provider;
    if (model) config.ai.model = model;
    if (audience) config.ai.audience = audience;

    // Run pipeline
    const result = await runPipeline(from, to, config, { format });

    // Set outputs
    setOutput('release-notes', result.formatted);
    setOutput('version', result.notes.version);
    setOutput('change-count', String(result.notes.changes.length));

    console.log(`\n✓ Action complete — ${result.notes.changes.length} changes, published to: ${result.publishedTo.join(', ')}`);
  } catch (err) {
    setFailed((err as Error).message);
  }
}

const isDirectRun = (process.argv[1] || '').replace(/\\/g, '/').match(/\/action\.(cjs|mjs|js|ts)$/);
if (isDirectRun) {
  run().catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exitCode = 1;
  });
}
