import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Phase 4 e2e — exercises the live ingestion view, the graph page, and the
 * job stats dashboard against a running API + worker. Skips when the API is
 * unreachable so frontend-only CI stays green; the visual smoke procedure
 * (a real Claude.ai zip import in dev) is the canonical Phase 4 sign-off.
 */

const username = process.env['MNELA_TEST_USER'] ?? 'admin';
const password = process.env['MNELA_TEST_PASSWORD'] ?? 'mnela_dev_admin_pwd_!1';

async function loginOrSkip(page: Page, request: APIRequestContext): Promise<void> {
  const probe = await request
    .post('/_api/auth/login', { data: { username, password }, failOnStatusCode: false })
    .catch(() => null);
  test.skip(!probe || probe.status() !== 200, 'API unreachable or invalid credentials');

  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/');
}

test('live import view renders progress, file list, and graph pane', async ({ page, request }) => {
  await loginOrSkip(page, request);

  const fileBytes = Buffer.from(
    `# phase-4 e2e smoke\nThis exercises the live ingestion path.\n${new Date().toISOString()}\n`,
  );
  const upload = await request.post('/_api/documents/upload', {
    multipart: {
      file: { name: `phase4-${Date.now()}.md`, mimeType: 'text/markdown', buffer: fileBytes },
    },
    failOnStatusCode: false,
  });
  test.skip(upload.status() !== 201, 'document upload not accepted');
  const body = (await upload.json()) as { job: { id: string } };
  const jobId = body.job.id;

  await page.goto(`/imports/${jobId}`);

  // Progress header — status badge and progress bar are visible right away.
  await expect(page.getByRole('progressbar').first()).toBeVisible({ timeout: 10_000 });

  // File list eventually shows the uploaded markdown after the worker parses it.
  await expect(page.getByText(/phase-4/i).first()).toBeVisible({ timeout: 30_000 });

  // Live graph pane — the canvas mounts (Cytoscape renders into a child canvas).
  // We assert the wrapper element exists; jsdom-style assertions on the canvas
  // contents are owned by the @mnela/ui unit suite.
  await expect(page.locator('[data-testid="live-graph-pane"], canvas').first()).toBeVisible({
    timeout: 30_000,
  });
});

test('graph page renders filter sidebar and search bar', async ({ page, request }) => {
  await loginOrSkip(page, request);
  await page.goto('/graph');

  // Filter sidebar — at least one entity-type checkbox must be present.
  await expect(page.getByRole('checkbox').first()).toBeVisible({ timeout: 10_000 });

  // Layout switcher buttons.
  await expect(page.getByRole('button', { name: /cose|circular|grid/i }).first()).toBeVisible();

  // Search bar reachable.
  await expect(page.getByPlaceholder(/search/i).first()).toBeVisible();
});

test('/jobs surfaces the enrichment section and expandable stats', async ({ page, request }) => {
  await loginOrSkip(page, request);
  // /admin/jobs now redirects to /jobs; both URLs land on the same page.
  await page.goto('/admin/jobs');
  await expect(page).toHaveURL(/\/jobs$/, { timeout: 10_000 });

  // Top "Enrichment" section is always present.
  await expect(page.getByText(/^Enrichment$/).first()).toBeVisible({ timeout: 10_000 });
  // Failed-jobs section header always renders (collapsible).
  await expect(page.getByText(/^Failed \(\d+\)$/).first()).toBeVisible();
  // Stats is collapsed by default — expand and verify the three tiles render.
  await page.getByText(/Stats \(last 24h\)/i).click();
  await expect(page.getByText(/throughput/i).first()).toBeVisible();
  await expect(page.getByText(/duration/i).first()).toBeVisible();
  await expect(page.getByText(/error rate/i).first()).toBeVisible();
});
