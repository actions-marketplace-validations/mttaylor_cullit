import { test, expect } from '@playwright/test';

test.describe('support page', () => {
  test('shows open-source support messaging', async ({ page }) => {
    await page.goto('/pricing.html');

    await expect(page.getByRole('heading', { name: /fully free and open source/i })).toBeVisible();
    await expect(page.getByText(/no paid tiers, no checkout flow/i)).toBeVisible();
  });

  test('includes GitHub sponsor and repository links', async ({ page }) => {
    await page.goto('/pricing.html');

    const sponsorLink = page.getByRole('link', { name: /sponsor on github/i });
    await expect(sponsorLink).toHaveAttribute('href', 'https://github.com/sponsors/mttaylor');

    const repoLink = page.getByRole('link', { name: /view repository/i });
    await expect(repoLink).toHaveAttribute('href', 'https://github.com/mttaylor/cullit');
  });
});
