#!/usr/bin/env node

/**
 * Cull CLI
 * AI-powered release notes that write themselves.
 * 
 * Usage:
 *   cullit generate --from v1.0.0 --to v1.1.0
 *   cullit generate --from abc123 --to def456
 *   cullit init
 * 
 * https://cullit.io
 */

import { runPipeline, VERSION, createLogger } from '@cullit/core';
import { loadConfig } from '@cullit/config';
import { getLatestTag, getRecentTags } from '@cullit/core';
import type { OutputFormat, LogLevel } from '@cullit/core';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';

// Load .env file if present (no dependency needed)
function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (key && val && !process.env[key]) {
      process.env[key] = val;
    }
  }
}
loadEnv();

const HELP = `
  ╔═══════════════════════════════════════════╗
  ║  Cullit v${VERSION}                           ║
  ║  Cull the noise from your releases.     ║
  ╚═══════════════════════════════════════════╝

  USAGE
    $ cullit <command> [options]

  COMMANDS
    generate    Generate release notes from git, Jira, or Linear
    init        Create a .cullit.yml config file
    tags        List recent tags in the current repo

  OPTIONS (generate)
    --from, -f    Start ref, JQL query, or Linear filter
    --to, -t      End ref (defaults to HEAD)
    --config, -c  Path to config file (default: .cullit.yml)
    --format      Output format: markdown, html, json (default: markdown)
    --dry-run     Generate but don't publish
    --provider    Override AI provider (anthropic, openai, gemini, ollama, openclaw, none)
    --source      Override source type (local, jira, linear)
    --audience    Override audience (developer, end-user, executive)
    --verbose     Show detailed output
    --quiet       Suppress all output except errors

  EXAMPLES
    $ cullit generate --from v1.0.0 --to v1.1.0
    $ cullit generate --from HEAD~10 --provider gemini
    $ cullit generate --from HEAD~5 --provider ollama --model llama3.1
    $ cullit generate --from HEAD~5 --provider none         # no AI key needed
    $ cullit generate --source jira --from "project = PROJ" --provider anthropic
    $ cullit generate --source linear --from "team:ENG" --provider openai
    $ cullit init
`;

const DEFAULT_YML = `# Cullit Configuration
# https://cullit.io/docs/config

ai:
  provider: anthropic          # anthropic | openai | gemini | ollama | openclaw | none
  # model: claude-sonnet-4-20250514  # optional: override default model
  audience: developer          # developer | end-user | executive
  tone: professional           # professional | casual | terse
  categories: [features, fixes, breaking, improvements, chores]

source:
  type: local                  # local | jira | linear
  # enrichment: [jira, linear] # uncomment to enable enrichment

publish:
  - type: stdout               # always output to terminal
  # - type: file
  #   path: RELEASE_NOTES.md
  # - type: slack
  #   webhook_url: $SLACK_WEBHOOK_URL
  # - type: discord
  #   webhook_url: $DISCORD_WEBHOOK_URL

# jira:
#   domain: yourcompany.atlassian.net
#   # Set JIRA_EMAIL and JIRA_API_TOKEN in your environment

# linear:
#   # Set LINEAR_API_KEY in your environment

# openclaw:
#   baseUrl: http://localhost:18789  # OpenClaw gateway URL
#   # Set OPENCLAW_TOKEN in your environment
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log(`cullit v${VERSION}`);
    process.exit(0);
  }

  if (command === 'init') {
    if (existsSync('.cullit.yml')) {
      console.log('⚠ .cullit.yml already exists. Delete it first to re-initialize.');
      process.exit(1);
    }
    await interactiveInit();
    process.exit(0);
  }

  if (command === 'tags') {
    const tags = getRecentTags(process.cwd(), 20);
    if (tags.length === 0) {
      console.log('No tags found in this repository.');
    } else {
      console.log('Recent tags:');
      tags.forEach((t, i) => console.log(`  ${i === 0 ? '→' : ' '} ${t}`));
    }
    process.exit(0);
  }

  if (command === 'generate') {
    const opts = parseArgs(args.slice(1));

    const from = opts.from || opts.f;
    let to = opts.to || opts.t || 'HEAD';

    if (!from) {
      // Try to auto-detect: use second-most-recent tag as "from"
      const tags = getRecentTags();
      if (tags.length >= 2) {
        console.log(`» Auto-detected: generating notes from ${tags[1]} to ${tags[0]}`);
        const autoFrom = tags[1];
        to = tags[0];
        return await runGenerate(autoFrom, to, opts);
      }

      console.error('Error: --from is required. Specify a tag, branch, or commit SHA.');
      console.error('  Example: cullit generate --from v1.0.0 --to v1.1.0');
      console.error('  Run "cullit tags" to see available tags.');
      process.exit(1);
    }

    return await runGenerate(from, to, opts);
  }

  console.error(`Unknown command: ${command}`);
  console.log(HELP);
  process.exit(1);
}

async function runGenerate(from: string, to: string, opts: Record<string, string>) {
  const config = loadConfig(opts.config || opts.c || process.cwd());

  // CLI overrides
  if (opts.provider) config.ai.provider = opts.provider as any;
  if (opts.audience) config.ai.audience = opts.audience as any;
  if (opts.model) config.ai.model = opts.model;
  if (opts.source) config.source.type = opts.source as any;

  const format = (opts.format || 'markdown') as OutputFormat;
  const dryRun = 'dry-run' in opts || 'dryRun' in opts;
  const logLevel: LogLevel = 'verbose' in opts ? 'verbose' : 'quiet' in opts ? 'quiet' : 'normal';
  const logger = createLogger(logLevel);

  try {
    const result = await runPipeline(from, to, config, { format, dryRun, logger });
  } catch (err) {
    console.error(`\n✗ Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

async function interactiveInit() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n  Cullit — Project Setup\n');

  const provider = await ask(rl, '  AI provider (anthropic/openai/gemini/ollama/openclaw/none) [anthropic]: ') || 'anthropic';
  const source = await ask(rl, '  Source type (local/jira/linear) [local]: ') || 'local';
  const audience = await ask(rl, '  Audience (developer/end-user/executive) [developer]: ') || 'developer';
  const tone = await ask(rl, '  Tone (professional/casual/terse) [professional]: ') || 'professional';

  let enrichment = '';
  if (source === 'local') {
    enrichment = await ask(rl, '  Enrich from (jira/linear/both/none) [none]: ') || 'none';
  }

  rl.close();

  const enrichmentLine = enrichment === 'both'
    ? '\n  enrichment: [jira, linear]'
    : enrichment === 'jira' || enrichment === 'linear'
    ? `\n  enrichment: [${enrichment}]`
    : '';

  const sections: string[] = [];

  if (enrichment === 'jira' || enrichment === 'both' || source === 'jira') {
    sections.push(`\njira:\n  domain: yourcompany.atlassian.net\n  # Set JIRA_EMAIL and JIRA_API_TOKEN in your environment`);
  }
  if (enrichment === 'linear' || enrichment === 'both' || source === 'linear') {
    sections.push(`\nlinear:\n  # Set LINEAR_API_KEY in your environment`);
  }

  const yml = `# Cullit Configuration
# https://cullit.io

ai:
  provider: ${provider}
  audience: ${audience}
  tone: ${tone}
  categories: [features, fixes, breaking, improvements, chores]

source:
  type: ${source}${enrichmentLine}

publish:
  - type: stdout
  # - type: file
  #   path: RELEASE_NOTES.md
  # - type: slack
  #   webhook_url: \$SLACK_WEBHOOK_URL
  # - type: discord
  #   webhook_url: \$DISCORD_WEBHOOK_URL
${sections.join('\n')}
`;

  writeFileSync('.cullit.yml', yml, 'utf-8');
  console.log('\n  ✓ Created .cullit.yml');
  console.log('  Run "cullit generate --from <tag>" to generate release notes.\n');
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.substring(1);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exitCode = 1;
});
