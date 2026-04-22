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

import { runPipeline, VERSION, createLogger, analyzeReleaseReadiness, resolveLicense, reportUsage, verifyIntegrations, formatVerifyResults, AI_PROVIDERS, AUDIENCES, TONES, SOURCE_TYPES, OUTPUT_FORMATS } from '@cullit/core';
import { loadConfig } from '@cullit/config';
import { getRecentTags } from '@cullit/core';
import type { OutputFormat, LogLevel } from '@cullit/core';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';

// Load pro plugins if installed (registers AI generators, Jira/Linear, Slack/Discord/GitHub)
try { await import('@cullit/pro'); } catch { /* pro not installed — free tier only */ }

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
    generate    Generate release notes from git or licensed sources
    status      Release readiness check — should you release?
    verify      Probe every configured integration (no publish)
    init        Create a .cullit.yml config file
    tags        List recent tags in the current repo

  OPTIONS (generate)
    --from, -f    Start ref, JQL query, or Linear filter
    --to, -t      End ref (defaults to HEAD)
    --config, -c  Path to config file (default: .cullit.yml)
    --format      Output format: markdown, html, html-dark, html-minimal, html-edgy, json
    --template    Template profile name from config.templates
    --dry-run     Generate but don't publish
    --provider    Override AI provider (anthropic, openai, gemini, ollama, none)
    --source      Override source type (local, jira, linear, gitlab, bitbucket)
    --audience    Override audience (developer, end-user, executive)
    --tone        Override tone (professional, casual, terse, edgy, hype, snarky)
    --verbose     Show detailed output
    --quiet       Suppress all output except errors

  NOTES
    Public npm package: local git + template mode + stdout/file
    Licensed/private Cullit surfaces add AI, enrichments, and premium publishers

  EXAMPLES
    $ cullit generate --from v1.0.0 --to v1.1.0
    $ cullit generate --from HEAD~5 --provider none         # no AI key needed
    $ cullit generate --from v1.2.0 --template customer-facing
    $ cullit generate --from HEAD~5 --tone edgy --format html-edgy
    $ cullit init
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

  if (command === 'status') {
    printReleaseStatus();
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

  if (command === 'verify') {
    const opts = parseArgs(args.slice(1));
    const configPath = opts.config || opts.c || '.cullit.yml';
    let config;
    try {
      config = await loadConfig(configPath);
    } catch (err) {
      console.error(`✗ Could not load ${configPath}: ${(err as Error).message}`);
      process.exit(1);
    }
    console.log(`Probing every integration declared in ${configPath}...`);
    const only = opts.only ? String(opts.only).split(',').map(s => s.trim()) : undefined;
    const results = await verifyIntegrations(config, { only });
    console.log(formatVerifyResults(results));
    const failed = results.filter(r => r.status === 'unreachable' || r.status === 'auth-failed');
    process.exit(failed.length > 0 ? 1 : 0);
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
  // Validate --config path stays within the project directory
  const configInput = opts.config || opts.c;
  if (configInput) {
    const resolvedConfig = resolve(configInput);
    const projectRoot = resolve(process.cwd());
    if (!resolvedConfig.startsWith(projectRoot)) {
      console.error('\n✗ Config error: config file must be within the current project directory');
      process.exitCode = 1;
      return;
    }
  }

  let config;
  try {
    config = loadConfig(configInput || process.cwd());
  } catch (err) {
    console.error(`\n✗ Config error: ${(err as Error).message}`);
    console.error('  Fix your .cullit.yml or delete it to use defaults.');
    process.exitCode = 1;
    return;
  }

  // CLI overrides with validation (uses well-known constants from core)
  const VALID_PROVIDERS = AI_PROVIDERS as readonly string[];
  const VALID_AUDIENCES = AUDIENCES as readonly string[];
  const VALID_SOURCES = SOURCE_TYPES as readonly string[];
  const VALID_TONES = TONES as readonly string[];
  type ProviderValue = (typeof AI_PROVIDERS)[number];
  type AudienceValue = (typeof AUDIENCES)[number];
  type SourceValue = (typeof SOURCE_TYPES)[number];
  type ToneValue = (typeof TONES)[number];

  if (opts.provider) {
    if (!VALID_PROVIDERS.includes(opts.provider)) {
      console.error(`\n✗ Invalid provider: ${opts.provider}`);
      console.error(`  Valid providers: ${VALID_PROVIDERS.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    config.ai.provider = opts.provider as ProviderValue;
  }
  if (opts.audience) {
    if (!VALID_AUDIENCES.includes(opts.audience)) {
      console.error(`\n✗ Invalid audience: ${opts.audience}`);
      console.error(`  Valid audiences: ${VALID_AUDIENCES.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    config.ai.audience = opts.audience as AudienceValue;
  }
  if (opts.tone) {
    if (!VALID_TONES.includes(opts.tone)) {
      console.error(`\n\u2717 Invalid tone: ${opts.tone}`);
      console.error(`  Valid tones: ${VALID_TONES.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    config.ai.tone = opts.tone as ToneValue;
  }
  if (opts.model) config.ai.model = opts.model;
  if (opts.source) {
    if (!VALID_SOURCES.includes(opts.source)) {
      console.error(`\n✗ Invalid source: ${opts.source}`);
      console.error(`  Valid sources: ${VALID_SOURCES.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    config.source.type = opts.source as SourceValue;
  }

  if (opts.format && !(OUTPUT_FORMATS as readonly string[]).includes(opts.format)) {
    console.error(`\n✗ Invalid format: ${opts.format}`);
    console.error(`  Valid formats: ${(OUTPUT_FORMATS as readonly string[]).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const format = (opts.format as OutputFormat | undefined);
  const dryRun = 'dry-run' in opts || 'dryRun' in opts;
  const logLevel: LogLevel = 'verbose' in opts ? 'verbose' : 'quiet' in opts ? 'quiet' : 'normal';
  const logger = createLogger(logLevel);
  const templateProfile = opts.template || opts.templateProfile || opts['template-profile'];

  // Show license tier
  const license = resolveLicense();
  if (logLevel !== 'quiet') {
    const tierLabel = license.tier === 'enterprise' ? '🏢 Enterprise'
      : license.tier === 'team' ? '👥 Team'
      : license.tier === 'pro' ? '🔑 Pro'
      : '🆓 Free';
    logger.info(`» License: ${tierLabel}`);
  }

  try {
    await runPipeline(from, to, config, { format, dryRun, logger, templateProfile });

    // Metering — best-effort, never blocks the pipeline
    reportUsage(from).catch(() => {});

    // Active release advisory — nudge after generating notes
    if (logLevel !== 'quiet') {
      try {
        const advisory = analyzeReleaseReadiness();
        if (advisory.shouldRelease && advisory.nextVersion) {
          console.log(`\n  💡 Release advisory: ${advisory.reasons[0]}`);
          console.log(`     Suggested: ${advisory.nextVersion} (${advisory.suggestedBump}) — ${advisory.commitCount} unreleased commit(s)`);
          console.log(`     Run "cullit status" for full breakdown.\n`);
        } else if (advisory.commitCount > 0 && advisory.daysSinceRelease !== null && advisory.daysSinceRelease > 7) {
          console.log(`\n  💡 ${advisory.commitCount} unreleased commit(s), ${advisory.daysSinceRelease} days since last release. Run "cullit status" to check readiness.\n`);
        }
      } catch {
        // Advisory is best-effort — never block generate
      }

      // Sponsor nudge — shown ~10% of the time, never on CI, never with --quiet
      if (!process.env['CI'] && Math.random() < 0.1) {
        console.log(`\n  ❤️  Cullit is built by one developer. If it saves you time, consider supporting:`);
        console.log(`     ⭐ https://github.com/mttaylor/cullit`);
        console.log(`     💖 https://github.com/sponsors/mttaylor\n`);
      }
    }
  } catch (err) {
    console.error(`\n✗ Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

function printReleaseStatus(): void {
  const advisory = analyzeReleaseReadiness();

  const bar = (count: number, max: number, char = '█') => {
    const width = Math.min(Math.round((count / Math.max(max, 1)) * 20), 20);
    return char.repeat(width) || '·';
  };

  console.log(`
  ╔═══════════════════════════════════════════╗
  ║  Cullit — Release Readiness               ║
  ╚═══════════════════════════════════════════╝
  `);

  if (!advisory.currentVersion) {
    console.log('  No tags found. Create your first release with:');
    console.log('    git tag v0.1.0 && git push --tags\n');
    return;
  }

  const { breakdown, commitCount } = advisory;
  const verdict = advisory.shouldRelease ? '🟢 Yes — time to release' : '🟡 Not yet — keep going';

  console.log(`  Current version:   ${advisory.currentVersion}`);
  if (advisory.nextVersion) {
    console.log(`  Suggested next:    ${advisory.nextVersion} (${advisory.suggestedBump})`);
  }
  if (advisory.daysSinceRelease !== null) {
    console.log(`  Last release:      ${advisory.daysSinceRelease} day(s) ago`);
  }
  console.log(`  Unreleased commits: ${commitCount}`);
  console.log(`  Contributors:      ${advisory.contributorCount}`);

  if (commitCount > 0) {
    console.log('\n  Commit breakdown:');
    const maxCount = Math.max(breakdown.features, breakdown.fixes, breakdown.breaking, breakdown.chores, breakdown.other, 1);
    if (breakdown.features > 0)  console.log(`    ✨ Features:  ${bar(breakdown.features, maxCount)} ${breakdown.features}`);
    if (breakdown.fixes > 0)     console.log(`    🐛 Fixes:     ${bar(breakdown.fixes, maxCount)} ${breakdown.fixes}`);
    if (breakdown.breaking > 0)  console.log(`    ⚠️  Breaking:  ${bar(breakdown.breaking, maxCount)} ${breakdown.breaking}`);
    if (breakdown.chores > 0)    console.log(`    🧹 Chores:    ${bar(breakdown.chores, maxCount)} ${breakdown.chores}`);
    if (breakdown.other > 0)     console.log(`    📝 Other:     ${bar(breakdown.other, maxCount)} ${breakdown.other}`);
  }

  console.log(`\n  Should you release? ${verdict}`);

  if (advisory.reasons.length > 0) {
    console.log('\n  Why:');
    for (const reason of advisory.reasons) {
      console.log(`    → ${reason}`);
    }
  }

  if (advisory.shouldRelease && advisory.nextVersion) {
    console.log(`\n  Quick release:`);
    console.log(`    cullit generate --from ${advisory.currentVersion} --to HEAD`);
    console.log(`    git tag ${advisory.nextVersion} && git push --tags`);
  }

  console.log('');
}

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

async function interactiveInit() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const VALID_PROVIDERS = AI_PROVIDERS as readonly string[];
  const VALID_SOURCES = SOURCE_TYPES as readonly string[];
  const VALID_AUDIENCES = AUDIENCES as readonly string[];
  const VALID_TONES = TONES as readonly string[];
  const VALID_ENRICHMENTS = ['jira', 'linear', 'both', 'none'];

  console.log('\n  Cullit — Project Setup\n');

  const provider = await ask(rl, '  AI provider (anthropic/openai/gemini/ollama/none) [none]: ') || 'none';
  if (!VALID_PROVIDERS.includes(provider)) {
    console.error(`\n  ✗ Invalid provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
    rl.close();
    process.exit(1);
  }

  const source = await ask(rl, '  Source type (local/jira/linear/gitlab/bitbucket) [local]: ') || 'local';
  if (!VALID_SOURCES.includes(source)) {
    console.error(`\n  ✗ Invalid source: ${source}. Must be one of: ${VALID_SOURCES.join(', ')}`);
    rl.close();
    process.exit(1);
  }

  const audience = await ask(rl, '  Audience (developer/end-user/executive) [developer]: ') || 'developer';
  if (!VALID_AUDIENCES.includes(audience)) {
    console.error(`\n  ✗ Invalid audience: ${audience}. Must be one of: ${VALID_AUDIENCES.join(', ')}`);
    rl.close();
    process.exit(1);
  }

  const tone = await ask(rl, '  Tone (professional/casual/terse/edgy/hype/snarky) [professional]: ') || 'professional';
  if (!VALID_TONES.includes(tone)) {
    console.error(`\n  ✗ Invalid tone: ${tone}. Must be one of: ${VALID_TONES.join(', ')}`);
    rl.close();
    process.exit(1);
  }

  let enrichment = '';
  if (source === 'local') {
    enrichment = await ask(rl, '  Enrich from (jira/linear/both/none) [none]: ') || 'none';
    if (!VALID_ENRICHMENTS.includes(enrichment)) {
      console.error(`\n  ✗ Invalid enrichment: ${enrichment}. Must be one of: ${VALID_ENRICHMENTS.join(', ')}`);
      rl.close();
      process.exit(1);
    }
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
  if (source === 'gitlab') {
    sections.push(`\ngitlab:\n  projectId: "12345"  # GitLab project ID\n  # domain: gitlab.com  # optional: self-hosted domain\n  # Set GITLAB_TOKEN in your environment`);
  }
  if (source === 'bitbucket') {
    sections.push(`\nbitbucket:\n  workspace: your-workspace\n  repoSlug: your-repo\n  # Set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD in your environment`);
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
  #   webhook_url: $SLACK_WEBHOOK_URL
  # - type: discord
  #   webhook_url: $DISCORD_WEBHOOK_URL
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
