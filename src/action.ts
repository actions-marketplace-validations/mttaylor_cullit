/**
 * GitHub Action entry point for Cullit.
 * Reads inputs from environment, runs the pipeline, and sets outputs.
 * 
 * This file is bundled to dist/index.js via:
 *   pnpm build:action
 */

import { runPipeline } from '../packages/core/src/index';
import { loadConfig } from '../packages/config/src/index';
import type { CullConfig, OutputFormat, AIProvider, Audience, Tone, PublishTarget } from '../packages/core/src/types';
import { DEFAULT_CATEGORIES } from '../packages/core/src/constants';
import { appendFileSync } from 'fs';

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

async function run(): Promise<void> {
  try {
    // Read inputs
    const from = getInput('from');
    const to = getInput('to') || 'HEAD';
    const configPath = getInput('config');
    const provider = getInput('provider') as AIProvider || 'anthropic';
    const model = getInput('model');
    const audience = (getInput('audience') || 'developer') as Audience;
    const tone = (getInput('tone') || 'professional') as Tone;
    const format = (getInput('format') || 'markdown') as OutputFormat;
    const slackWebhook = getInput('publish-slack-webhook');
    const discordWebhook = getInput('publish-discord-webhook');
    const githubRelease = getInput('publish-github-release') === 'true';
    const jiraDomain = getInput('jira-domain');

    if (!from) {
      setFailed('Input "from" is required. Specify a tag, branch, or commit SHA.');
      return;
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

      config = {
        ai: {
          provider,
          model: model || undefined,
          audience,
          tone,
          categories: DEFAULT_CATEGORIES,
        },
        source: {
          type: 'local',
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

run();
