import { test, expect, Page } from '@playwright/test';

/**
 * Wait for a tool result containing the expected key, then parse and return the JSON.
 */
async function waitForToolResult(page: Page, expectedKey: string): Promise<unknown> {
  // Tool drawer response (mastra-ai/mastra#25621): status badge + highlighted JSON in <pre><code>.
  const response = page.getByRole('region', { name: 'Response' });
  const jsonPanel = response.locator('pre code');
  await expect(jsonPanel).toContainText(expectedKey, { timeout: 10_000 });
  await expect(response).toContainText('Success');
  const text = await jsonPanel.textContent();
  if (!text) throw new Error('Tool result panel has no text content');
  return JSON.parse(text);
}

/**
 * Tool detail pages were replaced by a drawer opened via `?tool=<id>` (mastra-ai/mastra#25621).
 * Open it, verify it is the requested tool, and switch to the Playground tab.
 */
async function openToolPlayground(page: Page, toolId: string) {
  await page.goto(`/tools?tool=${toolId}`);
  const drawer = page.getByRole('dialog', { name: toolId });
  await expect(drawer.getByRole('heading', { name: toolId, level: 3 })).toBeVisible();
  await drawer.getByRole('tab', { name: 'Playground' }).click();
  await expect(drawer.getByRole('heading', { name: 'No response yet' })).toBeVisible();
  return drawer;
}

test.describe('Tool Execution', () => {
  test('tools list page shows registered tools', async ({ page }) => {
    await page.goto('/tools');

    await expect(page.locator('h1')).toHaveText('Tools');
    await expect(page.getByRole('link', { name: 'calculator' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'string-transform' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'needs-approval' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'always-fails' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'timestamp' })).toBeVisible();

    // Clicking a tool opens its drawer on the Overview tab, with schema and usage.
    await page.getByRole('link', { name: 'calculator' }).click();
    await expect(page).toHaveURL(/\/tools\?tool=calculator/);
    const drawer = page.getByRole('dialog', { name: 'calculator' });
    await expect(drawer.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await expect(drawer.getByText('Performs basic arithmetic operations')).toBeVisible();
    await expect(drawer.getByRole('region', { name: 'Used by' }).getByRole('link', { name: 'Test Agent' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close Panel' }).click();
    await expect(drawer).toBeHidden();
  });

  test('calculator tool: add 5 + 3 = 8', async ({ page }) => {
    const drawer = await openToolPlayground(page, 'calculator');

    // Select operation
    await drawer.getByRole('combobox', { name: /^Operation/ }).click();
    await page.getByRole('option', { name: 'add' }).click();

    // Fill inputs
    await drawer.getByRole('spinbutton', { name: /^A\b/ }).fill('5');
    await drawer.getByRole('spinbutton', { name: /^B\b/ }).fill('3');

    // Submit and verify
    await drawer.getByRole('button', { name: 'Run' }).click();
    const result = await waitForToolResult(page, 'result');
    expect(result).toEqual({ result: 8 });
  });

  test('calculator tool: multiply 7 * 6 = 42', async ({ page }) => {
    const drawer = await openToolPlayground(page, 'calculator');

    await drawer.getByRole('combobox', { name: /^Operation/ }).click();
    await page.getByRole('option', { name: 'multiply' }).click();

    await drawer.getByRole('spinbutton', { name: /^A\b/ }).fill('7');
    await drawer.getByRole('spinbutton', { name: /^B\b/ }).fill('6');
    await drawer.getByRole('button', { name: 'Run' }).click();

    const result = await waitForToolResult(page, 'result');
    expect(result).toEqual({ result: 42 });
  });

  test('string-transform tool: uppercase', async ({ page }) => {
    const drawer = await openToolPlayground(page, 'string-transform');

    await drawer.getByRole('combobox', { name: /^Transform/ }).click();
    await page.getByRole('option', { name: 'upper' }).click();

    await drawer.getByRole('textbox', { name: /^Text/ }).fill('hello world');
    await drawer.getByRole('button', { name: 'Run' }).click();

    const result = await waitForToolResult(page, 'result');
    expect(result).toEqual({ result: 'HELLO WORLD' });
  });

  test('timestamp tool: no input required', async ({ page }) => {
    const drawer = await openToolPlayground(page, 'timestamp');

    // No inputs to fill — just run
    await drawer.getByRole('button', { name: 'Run' }).click();

    const result = (await waitForToolResult(page, 'timestamp')) as { timestamp: number; iso: string };
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('string-transform tool: reverse', async ({ page }) => {
    const drawer = await openToolPlayground(page, 'string-transform');

    await drawer.getByRole('combobox', { name: /^Transform/ }).click();
    await page.getByRole('option', { name: 'reverse' }).click();

    await drawer.getByRole('textbox', { name: /^Text/ }).fill('abcdef');
    await drawer.getByRole('button', { name: 'Run' }).click();

    const result = await waitForToolResult(page, 'result');
    expect(result).toEqual({ result: 'fedcba' });
  });

  test('needs-approval tool: executes in playground without approval gate', async ({ page }) => {
    const drawer = await openToolPlayground(page, 'needs-approval');

    await drawer.getByRole('textbox', { name: /^Name/ }).fill('SmokeTest');
    await drawer.getByRole('button', { name: 'Run' }).click();

    // In the tool playground, requireApproval is bypassed — tool executes directly
    const result = await waitForToolResult(page, 'greeting');
    expect(result).toEqual({ greeting: 'Hello, SmokeTest!' });
  });

  test('always-fails tool: error status and message are shown', async ({ page }) => {
    const drawer = await openToolPlayground(page, 'always-fails');

    await drawer.getByRole('textbox', { name: /^Message/ }).fill('smoke-boom');
    await drawer.getByRole('button', { name: 'Run' }).click();

    const response = drawer.getByRole('region', { name: 'Response' });
    await expect(response).toContainText('Error', { timeout: 10_000 });
    await expect(response).not.toContainText('Success');
    await expect(response.locator('pre code')).toContainText('Tool error: smoke-boom');
  });
});
