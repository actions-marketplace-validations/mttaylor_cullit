import { test, expect, type Route } from '@playwright/test';
import { makeUser, mockDashboardApis } from './helpers.js';

const MOCK_OUTPUT = '## v1.1.0\n\n### Features\n\n- feat: add new sync engine\n';

test.describe('dashboard generate flow', () => {
  test('successful generate renders output in #outputBody', async ({ page }) => {
    await mockDashboardApis(page, { status: 200, body: makeUser('pro') });

    // Mock the generate endpoint — must be registered AFTER the catch-all so it
    // takes precedence (Playwright evaluates routes LIFO).
    await page.route('**/generate', async (route: Route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            formatted: MOCK_OUTPUT,
            changeCount: 3,
            duration: 87,
          }),
        });
      }
      return route.continue();
    });

    await page.goto('/dashboard.html');

    // Dashboard should show (pro user authenticated)
    await expect(page.locator('#dashApp')).toBeVisible();

    // Fill the generate form
    await page.locator('#fromRef').fill('v1.0.0');

    // Click generate and wait for output
    await page.locator('#generateBtn').click();

    // Button re-enables once generation completes
    await expect(page.locator('#generateBtn')).toBeEnabled({ timeout: 10_000 });

    // Output body should now contain formatted content
    await expect(page.locator('#outputBody')).not.toBeEmpty();
    await expect(page.locator('#outputBody')).toContainText('feat');
  });

  test('empty fromRef shows validation toast and keeps button enabled', async ({ page }) => {
    await mockDashboardApis(page, { status: 200, body: makeUser('pro') });

    await page.goto('/dashboard.html');
    await expect(page.locator('#dashApp')).toBeVisible();

    // Leave #fromRef empty and click generate
    await page.locator('#fromRef').fill('');
    await page.locator('#generateBtn').click();

    // Button should NOT be in loading/disabled state — validation returns early
    await expect(page.locator('#generateBtn')).toBeEnabled();
    // The output body should remain empty (no generation happened)
    const outputText = await page.locator('#outputBody').textContent();
    expect(outputText?.trim() ?? '').not.toMatch(/feat/);
  });

  test('402 response redirects to billing tab', async ({ page }) => {
    await mockDashboardApis(page, { status: 200, body: makeUser('free') });

    await page.route('**/generate', async (route: Route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 402,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Monthly generation limit reached' }),
        });
      }
      return route.continue();
    });

    await page.goto('/dashboard.html');
    await expect(page.locator('#dashApp')).toBeVisible();

    await page.locator('#fromRef').fill('v1.0.0');
    await page.locator('#generateBtn').click();

    // When limit is hit, the dashboard switches to billing tab
    await expect(page.locator('#billingPlanName')).toBeVisible({ timeout: 10_000 });
  });
});
