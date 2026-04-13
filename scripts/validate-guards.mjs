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

// Pricing page checks are regex-based to avoid failures on harmless whitespace/layout shifts.
if (!hasPattern(pricing, /<div\s+class="plan-name">\s*Free\s*<\/div>/i)) {
  fail('pricing page is missing Free plan heading');
}
if (!hasPattern(pricing, /<div\s+class="plan-name">\s*Paid\s*<\/div>/i)) {
  fail('pricing page is missing Paid plan heading');
}
if (!hasPattern(pricing, /\$8\.00\s*<span\s+class="period">/i)) {
  fail('pricing page is missing Paid price formatting');
}
if (!hasPattern(pricing, /<div\s+class="plan-name">\s*Enterprise\s*<\/div>/i)) {
  fail('pricing page is missing Enterprise plan heading');
}


if (!hasPattern(pricing, /Cancel anytime from the\s*<a\s+href="dashboard\.html">\s*billing dashboard\s*<\/a>/i)) {
  fail('pricing page is missing billing dashboard trust link');
}
if (!hasPattern(terms, /All fees are non-refundable except as required by\s+(?:applicable\s+)?law/i)) {
  fail('TERMS is missing non-refundable legal statement');
}

if (!hasPattern(appDockerfile, /COPY\s+\.npmrc\s+\.\//)) {
  fail('packages/app/Dockerfile must copy .npmrc before frozen pnpm install');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('guard checks passed');
