import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

describe('Deployment configuration', () => {
  describe('Dockerfile', () => {
    const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf-8');

    it('copies .npmrc in the deps stage', () => {
      // The deps stage COPY must include .npmrc to avoid ERR_PNPM_LOCKFILE_CONFIG_MISMATCH
      const depsSection = dockerfile.split(/FROM.*AS production/)[0];
      expect(depsSection).toContain('.npmrc');
    });

    it('copies .npmrc in the production stage', () => {
      // The production stage must also have .npmrc for pnpm install --prod
      expect(dockerfile).toMatch(/FROM.*AS production[\s\S]*?COPY.*\.npmrc/);
    });

    it('pins pnpm version (not @latest)', () => {
      const corepackLines = dockerfile.match(/corepack prepare pnpm@[\w.]+/g) || [];
      expect(corepackLines.length).toBeGreaterThanOrEqual(2); // base + production
      for (const line of corepackLines) {
        expect(line).not.toContain('pnpm@latest');
        // Should be a semver version like pnpm@10.32.1
        expect(line).toMatch(/pnpm@\d+\.\d+\.\d+/);
      }
    });

    it('uses pnpm -r build instead of pnpm build (skips action bundle)', () => {
      const buildLines = dockerfile.match(/RUN pnpm.+build/g) || [];
      // Should use "pnpm -r build" to build only workspace packages, not "pnpm build"
      // which would also run build:action (GitHub Action bundle not needed in Docker)
      const hasPnpmRBuild = buildLines.some(l => l.includes('pnpm -r build'));
      const hasPnpmBuild = buildLines.some(l => /pnpm build$/.test(l.trim()));
      expect(hasPnpmRBuild).toBe(true);
      expect(hasPnpmBuild).toBe(false);
    });

    it('runs as non-root user', () => {
      expect(dockerfile).toContain('USER cullit');
    });

    it('includes health check dependencies (curl)', () => {
      expect(dockerfile).toMatch(/apk add.*curl/);
    });
  });

  describe('railway.toml', () => {
    const railwayConfig = readFileSync(join(ROOT, 'railway.toml'), 'utf-8');

    it('uses Dockerfile builder', () => {
      expect(railwayConfig).toMatch(/builder\s*=\s*"dockerfile"/i);
    });

    it('has a health check path', () => {
      expect(railwayConfig).toMatch(/healthcheckPath\s*=\s*"\/health"/);
    });

    it('starts the API server', () => {
      expect(railwayConfig).toMatch(/startCommand.*node.*packages\/api\/dist\/index\.js/);
    });
  });

  describe('package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

    it('has packageManager field pinning pnpm version', () => {
      expect(pkg.packageManager).toBeDefined();
      expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    });
  });

  describe('.npmrc', () => {
    const npmrc = readFileSync(join(ROOT, '.npmrc'), 'utf-8');

    it('sets auto-install-peers to false', () => {
      expect(npmrc).toContain('auto-install-peers=false');
    });
  });
});

describe('Dashboard XSS hardening', () => {
  const dashboardHtml = readFileSync(join(ROOT, 'site', 'dashboard.html'), 'utf-8');
  const dashboardJs = readFileSync(join(ROOT, 'site', 'assets', 'dashboard.js'), 'utf-8');
  const dashboard = dashboardHtml + '\n' + dashboardJs;

  it('escapes d.provider and d.model in draft list view', () => {
    // Draft list should use escapeHtml() on provider/model fields
    expect(dashboard).toContain('escapeHtml(d.provider)');
    expect(dashboard).toContain('escapeHtml(d.model');
  });

  it('escapes d.provider and d.model in draft detail view', () => {
    // Draft detail span should escape provider/model
    const detailSection = dashboard.slice(dashboard.indexOf('loadDraftDetail'));
    expect(detailSection).toContain('escapeHtml(d.provider)');
  });

  it('does not render d.formatted_html directly via innerHTML (uses simpleMarkdown instead)', () => {
    // formatted_html should not be the direct value assigned to innerHTML
    // It can be used as a condition (truthy check), but `simpleMarkdown` on formatted_md should be rendered
    const dashboardLine = dashboard.split('\n').find(l => l.includes('formatted_html'));
    expect(dashboardLine).toBeDefined();
    // Must use simpleMarkdown or escapeHtml to render, not raw formatted_html
    expect(dashboardLine).toContain('simpleMarkdown');
  });

  it('draftStatusBadge escapes the status text', () => {
    const badgeFn = dashboard.slice(dashboard.indexOf('function draftStatusBadge'), dashboard.indexOf('function draftStatusBadge') + 500);
    expect(badgeFn).toContain('escapeHtml(status)');
  });
});
