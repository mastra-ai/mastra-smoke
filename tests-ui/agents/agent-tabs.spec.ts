import { test, expect } from '@playwright/test';
import { agentView } from '../helpers';

// Studio's agent layout exposes Chat / Traces views. The Editor entry is an
// icon-only control next to the view links that is disabled because the smoke
// fixture has no MastraEditor registered. The agent-scoped Evals tab (and its
// /evaluate and /review routes) was removed upstream in mastra-ai/mastra#24205;
// evaluation now lives only under the global /experiments, /datasets, /scorers
// and /experiments/review-queue pages. These tests assert tab selection by URL
// and surface the presence of tab-specific landmarks.

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

  test('/agents/test-agent: tab list is exactly Chat and Traces', async ({ page }) => {
    await page.goto('/agents/test-agent/threads/new');
    await expect(page.getByRole('navigation', { name: 'Agent views' }).getByRole('link')).toHaveText(['Chat', 'Traces']);
    await expect(page.getByRole('navigation', { name: 'Agent views' }).getByRole('link', { name: 'Evals' })).toHaveCount(0);
  });

  test('/agents/test-agent/traces: Traces tab is active and scoped to the agent', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/agents/test-agent/traces');
    await expect(page).toHaveURL(/\/agents\/test-agent\/traces\?rootEntityType=agent&filterEntityId=test-agent/);

    const tracesTab = agentView(page, 'Traces');
    await expect(tracesTab).toHaveAttribute('aria-current', 'page');

    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
