import { test, expect, type Page } from '@playwright/test';

async function captureApiHeaders(page: Page) {
  const captured: Record<string, string>[] = [];
  await page.route('**/api/**', async route => {
    captured.push(route.request().headers());
    await route.continue();
  });
  await page.goto('/agents');
  await expect(page.locator('h1')).toHaveText('Agents');
  await expect(() => expect(captured.length).toBeGreaterThan(0)).toPass({ timeout: 5_000 });
  await page.unroute('**/api/**');
  return captured;
}

test.describe('Settings', () => {
  test('settings page displays configuration form', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1')).toHaveText('Settings');

    const general = page.getByRole('region', { name: 'General' });
    await expect(general.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    await expect(general.getByRole('radio', { name: 'System' })).toBeChecked();

    // Mastra instance URL field is pre-filled with the running server URL
    const connection = page.getByRole('region', { name: 'Mastra connection' });
    await expect(connection.getByRole('textbox', { name: 'Mastra instance URL' })).toHaveValue(new URL(page.url()).origin);
    await expect(connection.getByRole('textbox', { name: 'API prefix' })).toHaveValue('/api');

    await expect(connection.getByText('No request headers')).toBeVisible();
    await expect(connection.getByRole('button', { name: 'Add header' })).toBeVisible();
  });

  test('custom header is sent in API requests after saving and stops after removal', async ({ page }) => {
    await page.goto('/settings');
    const connection = page.getByRole('region', { name: 'Mastra connection' });

    // Edits are staged behind an "Unsaved changes" bar until saved.
    await connection.getByRole('button', { name: 'Add header' }).click();
    await expect(connection.getByText('1 request header')).toBeVisible();
    await connection.getByRole('textbox', { name: 'Header name' }).fill('X-Smoke-Test');
    // Once named, the value and remove controls are labelled after the header.
    await connection.getByRole('textbox', { name: 'Value of X-Smoke-Test' }).fill('header-value-42');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Unsaved changes')).toBeHidden();

    const withHeader = await captureApiHeaders(page);
    expect(withHeader.some(h => h['x-smoke-test'] === 'header-value-42')).toBeTruthy();

    // The header persists across navigation, then remove it
    await page.goto('/settings');
    await expect(connection.getByRole('textbox', { name: 'Header name' })).toHaveValue('X-Smoke-Test');
    await expect(connection.getByRole('textbox', { name: 'Value of X-Smoke-Test' })).toHaveValue('header-value-42');
    await connection.getByRole('button', { name: 'Remove X-Smoke-Test' }).click();
    await expect(connection.getByText('No request headers')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Unsaved changes')).toBeHidden();

    const withoutHeader = await captureApiHeaders(page);
    expect(withoutHeader.some(h => 'x-smoke-test' in h)).toBeFalsy();
  });
});
