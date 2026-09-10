import { test, expect } from '@playwright/test';

test.describe('Evaluation Dashboard', () => {
  test('/evaluation renders the overview dashboard and its sections', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/evaluation');
    await expect(page).toHaveURL(/\/evaluation/);
    const dashboard = page.getByRole('main');
    await expect(dashboard.getByRole('heading', { name: 'Overview', level: 1, exact: true })).toBeVisible();
    await expect(dashboard.getByRole('heading', { name: 'Scores', exact: true })).toBeVisible();
    await expect(dashboard.getByRole('heading', { name: 'Dataset Coverage by Target', exact: true })).toBeVisible();
    await expect(dashboard.getByRole('heading', { name: 'Experiments by Dataset', exact: true })).toBeVisible();
    await expect(dashboard.getByRole('heading', { name: 'Review Pipeline', exact: true })).toBeVisible();

    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
