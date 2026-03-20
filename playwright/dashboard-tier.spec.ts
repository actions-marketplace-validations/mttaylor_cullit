import { test, expect, type Page, type Route } from '@playwright/test';

type Tier = 'free' | 'pro' | 'team' | 'enterprise';

type Trial = {
  active: boolean;
  expired: boolean;
  tier: 'pro' | 'team' | null;
  startsAt: string | null;
  endsAt: string | null;
  daysRemaining: number;
};

function makeUser(tier: Tier, effectiveTier?: Tier, trial?: Trial) {
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
    trial: trial || {
      active: false,
      expired: false,
      tier: null,
      startsAt: null,
      endsAt: null,
      daysRemaining: 0,
    },
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
          trial: userResponse.body?.trial || {
            active: false,
            expired: false,
            tier: null,
            startsAt: null,
            endsAt: null,
            daysRemaining: 0,
          },
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

test('free tier shows free badge and team gates remain locked', async ({ page }) => {
  await mockDashboardApis(page, { status: 200, body: makeUser('free') });

  await page.goto('/dashboard.html');

  await expect(page.locator('#navTier')).toHaveText('free');
  await expect(page.locator('#trialBanner')).toBeHidden();

  await page.getByRole('button', { name: /drafts/i }).click();
  await expect(page.locator('#draftTeamGate')).toBeVisible();
});

test('pro tier unlocks pro badge but keeps team-only drafts gated', async ({ page }) => {
  await mockDashboardApis(page, { status: 200, body: makeUser('pro') });

  await page.goto('/dashboard.html');

  await expect(page.locator('#navTier')).toHaveText('pro');
  await page.getByRole('button', { name: /drafts/i }).click();
  await expect(page.locator('#draftTeamGate')).toBeVisible();
  await expect(page.locator('#billingPlanName')).toHaveText('Pro');
});

test('team tier unlocks draft workflow and team billing plan', async ({ page }) => {
  await mockDashboardApis(page, { status: 200, body: makeUser('team') });

  await page.goto('/dashboard.html');

  await expect(page.locator('#navTier')).toHaveText('team');
  await page.getByRole('button', { name: /drafts/i }).click();
  await expect(page.locator('#draftTeamGate')).toBeHidden();
  await expect(page.locator('#billingPlanName')).toHaveText('Team');
});

test('enterprise tier shows enterprise plan and unlocked draft flow', async ({ page }) => {
  await mockDashboardApis(page, { status: 200, body: makeUser('enterprise') });

  await page.goto('/dashboard.html');

  await expect(page.locator('#navTier')).toHaveText('enterprise');
  await page.getByRole('button', { name: /drafts/i }).click();
  await expect(page.locator('#draftTeamGate')).toBeHidden();
  await expect(page.locator('#billingPlanName')).toHaveText('Enterprise');
});

test('active trial user is displayed as pro trial with banner', async ({ page }) => {
  const trial: Trial = {
    active: true,
    expired: false,
    tier: 'pro',
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    daysRemaining: 1,
  };

  await mockDashboardApis(page, { status: 200, body: makeUser('free', 'pro', trial) });

  await page.goto('/dashboard.html');

  await expect(page.locator('#navTier')).toHaveText('pro trial');
  await expect(page.locator('#trialBanner')).toBeVisible();
  await expect(page.locator('#trialBannerText')).toContainText('trial active');
});
