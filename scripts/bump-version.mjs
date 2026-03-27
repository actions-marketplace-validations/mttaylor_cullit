#!/usr/bin/env node
/**
 * Sync version across the entire monorepo from a single source.
 *
 * Usage:
 *   node scripts/bump-version.mjs 1.18.0     # set explicit version
 *   node scripts/bump-version.mjs patch       # bump patch (1.17.0 → 1.17.1)
 *   node scripts/bump-version.mjs minor       # bump minor (1.17.0 → 1.18.0)
 *   node scripts/bump-version.mjs major       # bump major (1.17.0 → 2.0.0)
 *
 * Updates:
 *   - Root package.json (source of truth)
 *   - All workspace package.json files
 *   - packages/core/src/constants.ts (VERSION export)
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PACKAGES_DIR = resolve(ROOT, 'packages');

// --- Read current version from root package.json ---
const rootPkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
const current = rootPkg.version;

// --- Resolve target version ---
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/bump-version.mjs <version|patch|minor|major>');
  process.exit(1);
}

function bump(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  if (type === 'major') return `${major + 1}.0.0`;
  throw new Error(`Unknown bump type: ${type}`);
}

const target = ['patch', 'minor', 'major'].includes(arg) ? bump(current, arg) : arg;

if (!/^\d+\.\d+\.\d+$/.test(target)) {
  console.error(`Invalid version: ${target}`);
  process.exit(1);
}

console.log(`\n📦 Bumping version: ${current} → ${target}\n`);

// --- Update all package.json files ---
const pkgFiles = [resolve(ROOT, 'package.json')];
for (const dir of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (dir.isDirectory()) {
    const pkgPath = resolve(PACKAGES_DIR, dir.name, 'package.json');
    try {
      readFileSync(pkgPath);
      pkgFiles.push(pkgPath);
    } catch { /* no package.json */ }
  }
}

for (const pkgPath of pkgFiles) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.version = target;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  ✓ ${pkgPath.replace(ROOT, '.')}`);
}

// --- Update constants.ts ---
const constantsPath = resolve(PACKAGES_DIR, 'core', 'src', 'constants.ts');
let constants = readFileSync(constantsPath, 'utf-8');
constants = constants.replace(
  /export const VERSION = '.*?';/,
  `export const VERSION = '${target}';`,
);
writeFileSync(constantsPath, constants);
console.log(`  ✓ ./packages/core/src/constants.ts`);

console.log(`\n✅ Version bumped to ${target} in ${pkgFiles.length + 1} files\n`);
