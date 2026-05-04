#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    fail(`Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}

function hasPattern(text, pattern) {
  return pattern.test(text);
}

function fail(message) {
  console.error(`guard check failed: ${message}`);
  process.exitCode = 1;
}

const pricing = readText('site/pricing.html');
const terms = readText('TERMS.md');
const appDockerfile = readText('packages/app/Dockerfile');

if (!hasPattern(pricing, /fully\s+free\s+and\s+open\s+source/i)) {
  fail('pricing page is missing open-source statement');
}
if (!hasPattern(pricing, /github\.com\/sponsors\/mttaylor/i)) {
  fail('pricing page is missing GitHub Sponsors link');
}
if (!hasPattern(terms, /Donations\s+and\s+Sponsorships/i)) {
  fail('TERMS is missing donations/sponsorships section');
}

if (!hasPattern(appDockerfile, /COPY\s+\.npmrc\s+\.\//)) {
  fail('packages/app/Dockerfile must copy .npmrc before frozen pnpm install');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('guard checks passed');
