import { test, expect, type Route } from '@playwright/test';

// pricing.html calls getApiUrl() which on 127.0.0.1 returns http://localhost:3000
// so we intercept that origin with **/* glob patterns.

test.describe('pricing page checkout flow', () => {
  test('Pro plan checkout redirects to Stripe URL', async ({ page }) => {
    const stripeUrl = 'https://checkout.stripe.test/pay?session=abc123';

    // Mock the checkout API
    await page.route('**/v1/billing/checkout', async (route: Route) => {
      if (route.request().method() === 'POST') {
        const body = await route.request().postDataJSON();
        expect(body.plan).toBe('pro');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ url: stripeUrl }),
        });
      }
      return route.continue();
    });

    // Intercept the Stripe navigation and serve a minimal page so the test
    // stays in the Playwright-controlled context.
    await page.route('https://checkout.stripe.test/**', (route: Route) => {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stripe-mock</body></html>',
      });
    });

    // Also suppress the analytics event so it doesn't cause unhandled errors
    await page.route('**/v1/events', (route: Route) => route.fulfill({ status: 200, body: '{}' }));

    await page.goto('/pricing.html');

    // Trigger checkout and wait for the Stripe redirect
    const navigationPromise = page.waitForURL('https://checkout.stripe.test/**');
    await page.locator('a.plan-btn', { hasText: 'Start Pro' }).click();
    await navigationPromise;

    expect(page.url()).toContain('checkout.stripe.test');
  });

  test('401 response from checkout redirects to dashboard', async ({ page }) => {
    await page.route('**/v1/billing/checkout', async (route: Route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not authenticated' }),
        });
      }
      return route.continue();
    });

    await page.route('**/v1/events', (route: Route) => route.fulfill({ status: 200, body: '{}' }));

    await page.goto('/pricing.html');

    const navigationPromise = page.waitForURL('**/dashboard.html');
    await page.locator('a.plan-btn', { hasText: 'Start Pro' }).click();
    await navigationPromise;

    expect(page.url()).toContain('dashboard.html');
  });

  test('API error shows alert with error message', async ({ page }) => {
    await page.route('**/v1/billing/checkout', async (route: Route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Billing temporarily unavailable' }),
        });
      }
      return route.continue();
    });

    await page.route('**/v1/events', (route: Route) => route.fulfill({ status: 200, body: '{}' }));

    await page.goto('/pricing.html');

    // Capture the alert dialog
    const dialogPromise = page.waitForEvent('dialog');
    await page.locator('a.plan-btn', { hasText: 'Start Pro' }).click();
    const dialog = await dialogPromise;

    expect(dialog.message()).toContain('Billing temporarily unavailable');
    await dialog.dismiss();
  });

  test('network failure tracks checkout_failed event with network_error reason', async ({ page }) => {
    // When the billing API is unreachable, startCheckout() catches the error,
    // calls trackEvent('checkout_failed', { reason: 'network_error' }), and
    // then sets window.location.href to a mailto: link (OS-level; not testable
    // headlessly).  We verify the catch branch ran by intercepting the event call.
    let capturedEvent: any = null;

    await page.route('**/v1/billing/checkout', (route: Route) => route.abort('failed'));
    await page.route('**/v1/events', async (route: Route) => {
      if (route.request().method() === 'POST') {
        const body = await route.request().postDataJSON();
        if (body?.event === 'checkout_failed') capturedEvent = body;
      }
      return route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto('/pricing.html');
    await page.locator('a.plan-btn', { hasText: 'Start Pro' }).click();

    // Wait for the async catch branch and the trailing trackEvent fetch to complete
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.waitForTimeout(1_500);

    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent?.metadata?.reason).toBe('network_error');
  });
});
