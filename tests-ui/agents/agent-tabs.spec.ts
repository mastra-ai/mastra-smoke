import { test, expect } from '@playwright/test';

// Studio's agent layout exposes Chat / Traces / Evals tabs. The Editor entry is
// an icon-only control next to the tab list that is disabled because the smoke
// fixture has no MastraEditor registered. /review is a loader redirect into the
// Evals tab's Review sub-tab. These tests assert tab selection by URL and surface
// the presence of tab-specific landmarks.

test.describe('Agent layout tabs', () => {
  test('/agents/test-agent/editor: Editor entry is rendered but disabled', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/agents/test-agent/editor');
    await expect(page).toHaveURL(/\/agents\/test-agent\/editor/);

    const editorButton = page.getByRole('button', { name: 'Editor', exact: true });
    await expect(editorButton).toBeVisible();
    await expect(editorButton).toBeDisabled();
    // The editor route still renders its own sub-tabs, but without a registered
    // editor there is nothing to version.
    await expect(page.getByRole('tab', { name: 'System Prompt', exact: true })).toBeVisible();
    await expect(page.getByText('No versions yet')).toBeVisible();

    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('/agents/test-agent/evaluate: Evals tab is active and empty state shows', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/agents/test-agent/evaluate');
    await expect(page).toHaveURL(/\/agents\/test-agent\/evaluate/);

    const evalsTab = page.getByRole('tab', { name: 'Evals', exact: true });
    await expect(evalsTab).toHaveAttribute('aria-selected', 'true');

    // Evals exposes sub-tabs (Experiments / Datasets / Scorers / Review).
    await expect(page.getByRole('tab', { name: 'Experiments', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'No Experiments yet' })).toBeVisible();

    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('/agents/test-agent/review: redirects into the Evals Review sub-tab', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/agents/test-agent/review');
    await expect(page).toHaveURL(/\/agents\/test-agent\/evaluate\?tab=review/);

    await expect(page.getByRole('tab', { name: 'Evals', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute('aria-selected', 'true');

    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('/agents/test-agent/traces: Traces tab is active and scoped to the agent', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/agents/test-agent/traces');
    await expect(page).toHaveURL(/\/agents\/test-agent\/traces\?rootEntityType=agent&filterEntityId=test-agent/);

    const tracesTab = page.getByRole('tab', { name: 'Traces', exact: true });
    await expect(tracesTab).toHaveAttribute('aria-selected', 'true');

    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
