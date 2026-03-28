import { test, expect, type Route } from '@playwright/test';
import { makeUser, mockDashboardApis } from './helpers.js';

const DRAFT = {
  id: 'draft-1',
  project: 'cullit',
  version: 'v2.0.0',
  status: 'draft',
  provider: 'none',
  model: null,
  formatted_md: '## v2.0.0\n\n- feat: ship it',
  formatted_html: '<h2>v2.0.0</h2><ul><li>feat: ship it</li></ul>',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/** Register draft-specific routes AFTER the base catch-all so they take LIFO priority. */
async function mockDraftApis(
  page: Parameters<typeof mockDashboardApis>[0],
  drafts: typeof DRAFT[],
  draftDetail: typeof DRAFT = DRAFT,
  submitStatus = 'submitted',
  approveStatus = 'approved',
) {
  // Use a function predicate so the pattern matches ALL /v1/drafts/* sub-paths,
  // including /v1/drafts/draft-1 and /v1/drafts/draft-1/submit.
  await page.route(
    (url) => new URL(url).pathname.startsWith('/v1/drafts'),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());

      // POST /v1/drafts — create
      if (url.pathname === '/v1/drafts' && req.method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ draft: { ...DRAFT, id: 'draft-new' } }),
        });
      }

      // GET /v1/drafts — list
      if (url.pathname === '/v1/drafts' && req.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ drafts, total: drafts.length }),
        });
      }

      // POST /v1/drafts/:id/submit
      if (url.pathname.endsWith('/submit') && req.method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...draftDetail, status: submitStatus }),
        });
      }

      // POST /v1/drafts/:id/approve
      if (url.pathname.endsWith('/approve') && req.method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...draftDetail, status: approveStatus }),
        });
      }

      // POST /v1/drafts/:id/publish
      if (url.pathname.endsWith('/publish') && req.method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...draftDetail, status: 'published' }),
        });
      }

      // GET /v1/drafts/:id — single draft detail
      if (/\/v1\/drafts\/[^/]+$/.test(url.pathname) && req.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ draft: draftDetail }),
        });
      }

      return route.continue();
    },
  );
}

test.describe('dashboard drafts tab', () => {
  test('pro user sees team-gate banner on drafts tab', async ({ page }) => {
    await mockDashboardApis(page, { status: 200, body: makeUser('pro') });

    await page.goto('/dashboard.html');
    await expect(page.locator('#dashApp')).toBeVisible();

    await page.getByRole('button', { name: /drafts/i }).click();

    await expect(page.locator('#draftTeamGate')).toBeVisible();
  });

  test('team user sees draft list, not team gate', async ({ page }) => {
    await mockDashboardApis(page, { status: 200, body: makeUser('team') });
    await mockDraftApis(page, []);

    await page.goto('/dashboard.html');
    await expect(page.locator('#dashApp')).toBeVisible();

    await page.getByRole('button', { name: /drafts/i }).click();

    await expect(page.locator('#draftTeamGate')).toBeHidden();
    // Empty-state message appears instead of a gate
    await expect(page.locator('#draftList')).toContainText('No drafts');
  });

  test('team user can open a draft detail panel', async ({ page }) => {
    await mockDashboardApis(page, { status: 200, body: makeUser('team') });
    await mockDraftApis(page, [DRAFT]);

    await page.goto('/dashboard.html');
    await expect(page.locator('#dashApp')).toBeVisible();

    await page.getByRole('button', { name: /drafts/i }).click();

    // Wait for draft list item to render (it's injected via innerHTML)
    await expect(page.locator('#draftList div').first()).toBeVisible({ timeout: 5_000 });

    // Click the first draft item to open detail
    await page.locator('#draftList div').first().click();

    await expect(page.locator('#draftDetailPanel')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#draftDetailContent')).toContainText('feat: ship it');
  });

  test('team owner can submit a draft for review', async ({ page }) => {
    const ownerUser = { ...makeUser('team', 'team', 'owner') };
    await mockDashboardApis(page, { status: 200, body: ownerUser });
    await mockDraftApis(page, [DRAFT]);

    await page.goto('/dashboard.html');
    await expect(page.locator('#dashApp')).toBeVisible();

    await page.getByRole('button', { name: /drafts/i }).click();
    await expect(page.locator('#draftList div').first()).toBeVisible({ timeout: 5_000 });
    await page.locator('#draftList div').first().click();
    await expect(page.locator('#draftDetailPanel')).toBeVisible({ timeout: 5_000 });

    // Wait for detail actions to render — the submit button is injected via innerHTML
    await expect(page.locator('#draftDetailActions button').first()).toBeVisible({ timeout: 5_000 });

    // Intercept and capture the submit request
    const [submitRequest] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().endsWith('/v1/drafts/draft-1/submit') &&
          req.method() === 'POST',
      ),
      page.locator('#draftDetailActions button', { hasText: 'Submit for Review' }).click(),
    ]);

    expect(submitRequest).toBeTruthy();
  });

  test('enterprise user also sees draft list (not gate)', async ({ page }) => {
    await mockDashboardApis(page, { status: 200, body: makeUser('enterprise') });
    await mockDraftApis(page, []);

    await page.goto('/dashboard.html');
    await page.getByRole('button', { name: /drafts/i }).click();

    await expect(page.locator('#draftTeamGate')).toBeHidden();
  });
});
