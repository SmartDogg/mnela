import { expect, test } from '@playwright/test';

// These specs assume the Mnela API is running at MNELA_API_ORIGIN (default http://localhost:3000)
// with an admin user bootstrapped via ADMIN_INITIAL_USERNAME / ADMIN_INITIAL_PASSWORD.
// Skip if the API isn't reachable to keep the suite green in pure-frontend CI.

test('redirects unauthenticated traffic to /login', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.url()).toContain('/login');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('Cmd-K opens search overlay from the dashboard once signed in', async ({ page, request }) => {
  const username = process.env.MNELA_TEST_USER ?? 'admin';
  const password = process.env.MNELA_TEST_PASSWORD ?? 'mnela_dev_admin_pwd_!1';

  const probe = await request
    .post('/_api/auth/login', { data: { username, password }, failOnStatusCode: false })
    .catch(() => null);
  test.skip(!probe || probe.status() !== 200, 'API unreachable or invalid credentials');

  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/');

  await page.keyboard.press('Control+K');
  await expect(page.getByPlaceholder(/Search/)).toBeVisible();
});
