#!/usr/bin/env node
/**
 * Generate release notes for one or all tags using cullit with multiple AI providers.
 *
 * Usage:
 *   node scripts/generate-release-notes.mjs                 # all tags from v1.0.0+
 *   node scripts/generate-release-notes.mjs v1.10.0         # single tag
 *   node scripts/generate-release-notes.mjs --providers anthropic,openai
 *   node scripts/generate-release-notes.mjs v1.10.0 --allow-partial  # don't block on provider failures
 *
 * Outputs JSON files to site/releases/<version>.json
 *
 * By default, if ANY requested provider fails to generate, the script exits
 * non-zero (blocking). Pass --allow-partial to override and continue anyway.
 *
 * Requires: ANTHROPIC_API_KEY, OPENAI_API_KEY in .env or environment.
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RELEASES_DIR = resolve(ROOT, 'site', 'releases');
const CULLIT = resolve(ROOT, 'packages', 'cli', 'dist', 'index.js');

// --- Load .env ---
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && val && !process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// --- Parse args ---
const args = process.argv.slice(2);
let targetTag = null;
let providers = ['anthropic', 'openai', 'gemini', 'ollama'];
let allowPartial = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--providers' && args[i + 1]) {
    providers = args[i + 1].split(',').map(p => p.trim());
    i++;
  } else if (args[i] === '--allow-partial') {
    allowPartial = true;
  } else if (args[i].startsWith('v')) {
    targetTag = args[i];
  }
}

// --- Get tags ---
function getTags() {
  const raw = execSync('git tag --sort=v:refname', { cwd: ROOT, encoding: 'utf-8' });
  return raw.trim().split('\n').filter(t => /^v\d+\.\d+\.\d+$/.test(t));
}

function getTagDate(tag) {
  try {
    const date = execSync(`git log -1 --format=%ai ${tag}`, { cwd: ROOT, encoding: 'utf-8' }).trim();
    return date.split(' ')[0]; // YYYY-MM-DD
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

function getCommitCount(from, to) {
  try {
    const output = execSync(`git rev-list --count ${from}..${to}`, { cwd: ROOT, encoding: 'utf-8' });
    return parseInt(output.trim(), 10);
  } catch {
    return 0;
  }
}

function getFilesChanged(from, to) {
  try {
    const output = execSync(`git diff --name-only ${from}..${to}`, { cwd: ROOT, encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

// --- Detect Ollama model ---
function detectOllamaModel() {
  try {
    const out = execSync('ollama list', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = out.trim().split('\n').slice(1); // skip header
    const candidates = [];
    for (const line of lines) {
      const cols = line.split(/\s+/);
      const name = cols[0];
      if (!name || name.includes(':cloud')) continue;
      // Parse size (e.g. "4.9 GB", "42 GB", "2.0 GB")
      const sizeMatch = line.match(/([\d.]+)\s*(GB|MB)/i);
      const sizeGb = sizeMatch
        ? (sizeMatch[2].toUpperCase() === 'GB' ? parseFloat(sizeMatch[1]) : parseFloat(sizeMatch[1]) / 1024)
        : 999;
      candidates.push({ name, sizeGb });
    }
    // Prefer smallest model that fits in memory (< 20GB is safe for most systems)
    candidates.sort((a, b) => a.sizeGb - b.sizeGb);
    const usable = candidates.find(c => c.sizeGb < 20);
    return usable ? usable.name : (candidates[0]?.name || null);
  } catch { /* Ollama not available */ }
  return null;
}

const ollamaModel = detectOllamaModel();
const ollamaUnavailable = providers.includes('ollama') && !ollamaModel;
if (ollamaUnavailable) {
  console.log('⚠ Ollama not available or no local models found — will be reported as a failure\n');
} else if (ollamaModel) {
  console.log(`🦙 Ollama model detected: ${ollamaModel}\n`);
}

// --- Generate with cullit ---
// Returns { ok, content, error }. On failure, `error` holds the first
// meaningful line of stderr so callers can surface a diagnosable reason.
function generateNotes(from, to, provider, format) {
  try {
    const modelFlag = provider === 'ollama' && ollamaModel ? ` --model ${ollamaModel}` : '';
    const cmd = `node "${CULLIT}" generate --from ${from} --to ${to} --provider ${provider}${modelFlag} --format ${format} --dry-run`;
    const output = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 120_000,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Strip CLI info lines — content starts after "[DRY RUN" line
    const lines = output.split('\n');
    const dryRunIdx = lines.findIndex(l => l.includes('[DRY RUN'));
    const content = dryRunIdx >= 0
      ? lines.slice(dryRunIdx + 1).join('\n').trim()
      : output.trim();
    // Strip trailing "✓ Done in ..." line
    const cleaned = content.replace(/\n✓ Done in .+$/m, '').trim();
    if (!cleaned) {
      return { ok: false, content: null, error: 'empty output from generator' };
    }
    return { ok: true, content: cleaned, error: null };
  } catch (err) {
    const stderr = err.stderr?.toString() || '';
    const reason = stderr.split('\n').map(l => l.trim()).find(Boolean) || err.message;
    return { ok: false, content: null, error: reason };
  }
}

// --- Main ---
mkdirSync(RELEASES_DIR, { recursive: true });

const allTags = getTags();
// Only process v1.0.0 and above
const tags = allTags.filter(t => {
  const [major] = t.replace('v', '').split('.').map(Number);
  return major >= 1;
});

if (tags.length === 0) {
  console.error('No v1.x.x+ tags found.');
  process.exit(1);
}

const tagsToProcess = targetTag ? [targetTag] : tags;

// Build the tag pairs (from → to)
const pairs = [];
for (const tag of tagsToProcess) {
  const idx = allTags.indexOf(tag);
  const from = idx > 0 ? allTags[idx - 1] : `${tag}~50`; // first tag: look back 50 commits
  pairs.push({ from, to: tag });
}

console.log(`\n🚀 Generating release notes for ${pairs.length} version(s) with providers: ${providers.join(', ')}\n`);

// Collected provider failures across all versions — used to block at the end
// unless --allow-partial is set.
const failures = [];

for (const { from, to } of pairs) {
  const outPath = resolve(RELEASES_DIR, `${to}.json`);

  // Load existing data if present (to preserve already-generated providers)
  let existing = {};
  if (existsSync(outPath)) {
    try { existing = JSON.parse(readFileSync(outPath, 'utf-8')); } catch { /* ignore */ }
  }

  const date = getTagDate(to);
  const commits = getCommitCount(from, to);
  const filesChanged = getFilesChanged(from, to);

  console.log(`📦 ${to} (${from}..${to}) — ${commits} commits, ${filesChanged} files`);

  const providerResults = existing.providers || {};

  for (const provider of providers) {
    // Skip if already generated
    if (providerResults[provider]?.markdown && providerResults[provider]?.html) {
      console.log(`  ✓ ${provider} — already generated, skipping`);
      continue;
    }

    // Ollama requested but no local model available — record as a failure
    // rather than silently skipping, so the run blocks unless overridden.
    if (provider === 'ollama' && ollamaUnavailable) {
      console.log(`  ✗ ${provider} (Ollama not available or no local models found)`);
      failures.push({ version: to, provider, reason: 'Ollama not available or no local models found' });
      continue;
    }

    process.stdout.write(`  ⏳ ${provider}...`);

    const markdown = generateNotes(from, to, provider, 'markdown');
    const html = generateNotes(from, to, provider, 'html');

    // Require BOTH formats to succeed — a half-generated provider is a failure.
    if (markdown.ok && html.ok) {
      providerResults[provider] = {
        markdown: markdown.content,
        html: html.content,
        generatedAt: new Date().toISOString(),
      };
      console.log(` ✓`);
    } else {
      const reason = (!markdown.ok ? markdown.error : html.error) || 'unknown error';
      console.log(` ✗ (${reason})`);
      failures.push({ version: to, provider, reason });
    }
  }

  // Also generate a template-only version (no AI key needed) as fallback
  if (!providerResults.template?.markdown) {
    process.stdout.write(`  ⏳ template...`);
    const md = generateNotes(from, to, 'none', 'markdown');
    const html = generateNotes(from, to, 'none', 'html');
    if (md.ok && html.ok) {
      providerResults.template = {
        markdown: md.content,
        html: html.content,
        generatedAt: new Date().toISOString(),
      };
      console.log(` ✓`);
    } else {
      const reason = (!md.ok ? md.error : html.error) || 'unknown error';
      console.log(` ✗ (${reason})`);
      failures.push({ version: to, provider: 'template', reason });
    }
  }

  const release = {
    version: to,
    date,
    commits,
    filesChanged,
    providers: providerResults,
  };

  // Post-process: fix dates in generated content — AI providers embed today's date
  // but it should be the tag date
  const today = new Date().toISOString().split('T')[0];
  if (date !== today) {
    for (const [, prov] of Object.entries(release.providers)) {
      if (prov.markdown) {
        prov.markdown = prov.markdown.replace(
          new RegExp(`(##\\s+${to.replace('.', '\\.')}\\s+—\\s+)\\d{4}-\\d{2}-\\d{2}`),
          `$1${date}`
        );
      }
      if (prov.html) {
        prov.html = prov.html.replace(
          new RegExp(`(${to.replace('.', '\\.')}\\s+—\\s+)\\d{4}-\\d{2}-\\d{2}`),
          `$1${date}`
        );
      }
    }
  }

  writeFileSync(outPath, JSON.stringify(release, null, 2) + '\n');
  console.log(`  💾 ${outPath.replace(ROOT, '.')}\n`);
}

// Write an index file listing all releases
const indexPath = resolve(RELEASES_DIR, 'index.json');
const allReleaseFiles = tags
  .filter(t => existsSync(resolve(RELEASES_DIR, `${t}.json`)))
  .reverse() // newest first
  .map(t => {
    const data = JSON.parse(readFileSync(resolve(RELEASES_DIR, `${t}.json`), 'utf-8'));
    return {
      version: t,
      date: data.date,
      commits: data.commits,
      filesChanged: data.filesChanged,
      providers: Object.keys(data.providers || {}),
    };
  });

writeFileSync(indexPath, JSON.stringify(allReleaseFiles, null, 2) + '\n');
console.log(`✅ Done! ${allReleaseFiles.length} releases indexed at site/releases/index.json`);

// --- Block on any provider failure unless overridden ---
if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} provider generation failure(s):`);
  for (const f of failures) {
    console.error(`  - ${f.version} / ${f.provider}: ${f.reason}`);
  }
  if (allowPartial) {
    console.error('\n⚠ --allow-partial set — continuing despite failures. Partial results saved.');
  } else {
    console.error('\n🛑 Release blocked. Fix the provider(s) above, or re-run with --allow-partial to override.');
    process.exit(1);
  }
}
