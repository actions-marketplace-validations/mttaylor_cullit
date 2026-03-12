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

import { runPipeline } from '../../core/src/index';
import { loadConfig } from '../../config/src/index';
import { getLatestTag, getRecentTags } from '../../core/src/collectors/git';
import type { OutputFormat } from '../../core/src/types';
import { writeFileSync } from 'fs';

const VERSION = '0.1.0';

const HELP = `
  ╔═══════════════════════════════════════════╗
  ║  Cullit v${VERSION}                           ║
  ║  Cull the noise from your releases.     ║
  ╚═══════════════════════════════════════════╝

  USAGE
    $ cullit <command> [options]

  COMMANDS
    generate    Generate release notes between two git refs
    init        Create a .cullit.yml config file
    tags        List recent tags in the current repo

  OPTIONS (generate)
    --from, -f    Start ref (tag, branch, or commit SHA)
    --to, -t      End ref (defaults to HEAD)
    --config, -c  Path to config file (default: .cullit.yml)
    --format      Output format: markdown, html, json (default: markdown)
    --dry-run     Generate but don't publish
    --provider    Override AI provider (anthropic, openai)
    --audience    Override audience (developer, end-user, executive)

  EXAMPLES
    $ cullit generate --from v1.0.0 --to v1.1.0
    $ cullit generate --from v1.0.0 --dry-run
    $ cullit generate --from HEAD~10 --audience end-user
    $ cullit init
`;

const DEFAULT_YML = `# Cullit Configuration
# https://cullit.io/docs/config

ai:
  provider: anthropic          # anthropic | openai
  # model: claude-sonnet-4-20250514  # optional: override default model
  audience: developer          # developer | end-user | executive
  tone: professional           # professional | casual | terse
  categories: [features, fixes, breaking, improvements, chores]

source:
  type: local
  # enrichment: [jira, linear] # uncomment to enable enrichment

publish:
  - type: stdout               # always output to terminal
  # - type: file
  #   path: RELEASE_NOTES.md
  # - type: slack
  #   webhook_url: \$SLACK_WEBHOOK_URL
  # - type: discord
  #   webhook_url: \$DISCORD_WEBHOOK_URL

# jira:
#   domain: yourcompany.atlassian.net
#   # Set JIRA_EMAIL and JIRA_API_TOKEN in your environment

# linear:
#   # Set LINEAR_API_KEY in your environment
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log(`cull v${VERSION}`);
    process.exit(0);
  }

  if (command === 'init') {
    writeFileSync('.cullit.yml', DEFAULT_YML, 'utf-8');
    console.log('✓ Created .cullit.yml');
    console.log('  Edit it to configure your AI provider, integrations, and publish targets.');
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

  const format = (opts.format || 'markdown') as OutputFormat;
  const dryRun = 'dry-run' in opts || 'dryRun' in opts;

  try {
    const result = await runPipeline(from, to, config, { format, dryRun });
    process.exit(0);
  } catch (err) {
    console.error(`\n✗ Error: ${(err as Error).message}`);
    process.exit(1);
  }
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
  process.exit(1);
});
