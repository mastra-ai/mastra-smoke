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

test.describe('MCP Servers', () => {
  test('MCP servers list page shows registered servers', async ({ page }) => {
    await page.goto('/mcps');

    await expect(page.locator('h1')).toHaveText('MCP Servers');

    // The test-mcp server should be listed with 2 tools
    const mcpLink = page.getByRole('link', { name: 'Test MCP Server' });
    await expect(mcpLink).toBeVisible();
    await expect(mcpLink.locator(':scope > span:nth-child(4)')).toHaveText('2');
  });

  test('MCP server detail shows available tools', async ({ page }) => {
    await page.goto('/mcps/test-mcp');

    // Server heading
    await expect(page.locator('h1')).toHaveText('Test MCP Server');

    // Connect card (mastra-ai/mastra#24817): one tab per transport. @mastra/mcp 2.x
    // servers speak Streamable HTTP only, so there is no SSE tab.
    await expect(page.getByText('This MCP server speaks Streamable HTTP only (protocol 2026-07-28).')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText(['HTTP', 'CLI']);
    await expect(page.getByRole('tabpanel', { name: 'HTTP' })).toContainText(/\/api\/mcp\/test-mcp\/mcp$/);
    await expect(page.getByRole('button', { name: 'Copy HTTP Stream URL' })).toBeVisible();
    await page.getByRole('tab', { name: 'CLI' }).click();
    await expect(page.getByRole('tabpanel', { name: 'CLI' }).getByRole('button', { name: /^Copy / })).toBeVisible();

    // Available tools section
    await expect(page.getByRole('heading', { name: 'Available Tools' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'calculator' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'string-transform' })).toBeVisible();
  });

  test('execute MCP tool from UI', async ({ page }) => {
    // MCP tool pages became a drawer on the server page (mastra-ai/mastra#25621).
    await page.goto('/mcps/test-mcp');
    await page.getByRole('link', { name: 'calculator' }).click();
    await expect(page).toHaveURL(/\/mcps\/test-mcp\?tool=calculator/);
    const drawer = page.getByRole('dialog', { name: 'calculator' });
    await drawer.getByRole('tab', { name: 'Playground' }).click();

    // Fill the calculator form
    await drawer.getByRole('combobox', { name: /^Operation/ }).click();
    await page.getByRole('option', { name: 'multiply' }).click();

    await drawer.getByRole('spinbutton', { name: /^A\b/ }).fill('6');
    await drawer.getByRole('spinbutton', { name: /^B\b/ }).fill('7');
    await drawer.getByRole('button', { name: 'Run' }).click();

    // MCP tools wrap the output in an extra { result: ... } envelope
    const result = await waitForToolResult(page, 'result');
    expect(result).toEqual({ result: { result: 42 } });
  });
});
