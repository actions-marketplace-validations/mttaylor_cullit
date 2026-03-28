import { type Page, type Route } from '@playwright/test';

export type Tier = 'free' | 'pro' | 'team' | 'enterprise';

export function makeUser(
  tier: Tier,
  effectiveTier?: Tier,
  _trial?: unknown,
  role: string = 'member',
) {
  return {
    id: 'u1',
    login: 'octocat',
    name: 'Octo Cat',
    email: 'octo@example.com',
    avatarUrl: '',
    tier,
    effectiveTier: effectiveTier || tier,
    orgId: null,
    role,
    apiKey: 'clt_' + 'a'.repeat(32),
    createdAt: new Date().toISOString(),
  };
}

export async function mockDashboardApis(
  page: Page,
  userResponse: { status: number; body: any },
) {
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', version: 'test' }),
      });
    }

    if (url.pathname === '/v1/history') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [], total: 0, limit: 20, offset: 0 }),
      });
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ org: null, members: [] }),
      });
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: [] }),
      });
    }

    if (url.pathname === '/v1/changelog/projects') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: [] }),
      });
    }

    if (url.pathname.startsWith('/v1/changelog/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project: 'demo', releases: [] }),
      });
    }

    return route.continue();
  });
}
