import { test, expect, type Page, type Route } from '@playwright/test';

type Tier = 'free' | 'paid' | 'pro' | 'team' | 'enterprise';

function makeUser(tier: Tier, effectiveTier?: Tier) {
  return {
    id: 'u1',
    login: 'octocat',
    name: 'Octo Cat',
    email: 'octo@example.com',
    avatarUrl: '',
    tier,
    effectiveTier: effectiveTier || tier,
    orgId: null,
    role: 'member',
    apiKey: 'clt_' + 'a'.repeat(32),
    createdAt: new Date().toISOString(),
  };
}

async function mockDashboardApis(page: Page, userResponse: { status: number; body: any }) {
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());

    if (url.pathname === '/auth/me') {
      return route.fulfill({
        status: userResponse.status,
        contentType: 'application/json',
        body: JSON.stringify(userResponse.body),
      });
    }

    if (url.pathname === '/health' || url.pathname === '/healthz') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', version: 'test' }) });
    }

    if (url.pathname === '/v1/history') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], total: 0, limit: 20, offset: 0 }) });
    }

    if (url.pathname === '/v1/analytics/usage') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totals: { generations: 0, totalChanges: 0, avgDuration: 0 },
          daily: [],
          topProviders: [],
          monthlyGenerations: 0,
          tier: userResponse.body?.effectiveTier || 'free',
        }),
      });
    }

    if (url.pathname === '/v1/org') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ org: null, members: [] }) });
    }

    if (url.pathname === '/v1/billing/subscription') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscription: null,
          plan: userResponse.body?.effectiveTier || 'free',
          tier: userResponse.body?.tier || 'free',
          effectiveTier: userResponse.body?.effectiveTier || 'free',
        }),
      });
    }

    if (url.pathname === '/v1/projects/settings') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: [] }) });
    }

    if (url.pathname === '/v1/changelog/projects') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [] }) });
    }

    if (url.pathname.startsWith('/v1/changelog/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project: 'demo', releases: [] }) });
    }

    return route.continue();
  });
}

test('shows auth wall when /auth/me is unauthenticated', async ({ page }) => {
  await mockDashboardApis(page, { status: 401, body: { error: 'Not authenticated' } });

  await page.goto('/dashboard.html');

  await expect(page.locator('#authWall')).toBeVisible();
  await expect(page.locator('#dashApp')).toBeHidden();
});

test('free tier shows free badge and paid gates remain locked', async ({ page }) => {
  await mockDashboardApis(page, { status: 200, body: makeUser('free') });

  await page.goto('/dashboard.html');

  await expect(page.locator('#navTier')).toHaveText('free');

  // Drafts tab is disabled for free tier (tab gating)
  await expect(page.locator('.dash-tab[data-tab="drafts"]')).toBeDisabled();
});

test('paid tier unlocks all features and shows paid badge', async ({ page }) => {
  await mockDashboardApis(page, { status: 200, body: makeUser('paid') });

  await page.goto('/dashboard.html');

  await expect(page.locator('#navTier')).toHaveText('paid');
  // Drafts tab is enabled for paid tier
  await expect(page.locator('.dash-tab[data-tab="drafts"]')).toBeEnabled();
  await expect(page.locator('#billingPlanName')).toHaveText('Paid');
});

test('legacy pro tier maps to paid behavior', async ({ page }) => {
  await mockDashboardApis(page, { status: 200, body: makeUser('pro') });

  await page.goto('/dashboard.html');

  await expect(page.locator('#navTier')).toHaveText('pro');
  // Legacy pro maps to paid rank — drafts enabled
  await expect(page.locator('.dash-tab[data-tab="drafts"]')).toBeEnabled();
  await expect(page.locator('#billingPlanName')).toHaveText('Pro');
});

test('enterprise tier shows enterprise plan and unlocked draft flow', async ({ page }) => {
  await mockDashboardApis(page, { status: 200, body: makeUser('enterprise') });

  await page.goto('/dashboard.html');

  await expect(page.locator('#navTier')).toHaveText('enterprise');
  await page.getByRole('button', { name: /drafts/i }).click();
  await expect(page.locator('#draftTeamGate')).toBeHidden();
  await expect(page.locator('#billingPlanName')).toHaveText('Enterprise');
});


