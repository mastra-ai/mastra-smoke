import { test, expect, type Page } from '@playwright/test';

// Studio's chat composer now sends messages to the agent `send-message`
// endpoint (it previously used `/signals`, and `/stream` before that). The
// request context is nested under `ifIdle.streamOptions.requestContext`.
const SEND_MESSAGE_ROUTE = /\/api\/agents\/test-agent\/send-message$/;

type SendMessageBody = {
  ifIdle?: { streamOptions?: { requestContext?: Record<string, unknown> } };
};

function extractRequestContext(body: SendMessageBody | null): Record<string, unknown> | undefined {
  return body?.ifIdle?.streamOptions?.requestContext;
}

test.describe('Request Context', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
  });
  test.afterEach(() => {
    expect(pageErrors, 'unexpected browser errors').toEqual([]);
  });

  // The global /request-context page was removed (mastra-ai/mastra#25303). Request
  // context is now edited per entity from the composer's "Request context" popover
  // and persisted in localStorage under mastra-request-context:agent:<agentId>.
  async function saveAgentRequestContext(page: Page, json: string) {
    await page.getByRole('button', { name: 'Request context', exact: true }).click();
    const popover = page.getByRole('dialog').filter({ hasText: 'Request Context (JSON)' });
    const editor = popover.getByRole('textbox');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(json);
    await popover.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Request context saved locally')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(popover).not.toBeVisible();
  }

  async function captureNextSend(page: Page, message: string): Promise<SendMessageBody> {
    let captured: SendMessageBody | null = null;
    // The streamed body is only readable via route.request().postData() during interception.
    await page.route(SEND_MESSAGE_ROUTE, async route => {
      captured = JSON.parse(route.request().postData() ?? '{}');
      await route.continue();
    });
    const chatInput = page.getByRole('textbox', { name: /message/i });
    await chatInput.fill(message);
    await chatInput.press('Enter');
    await expect.poll(() => captured, { timeout: 30_000 }).not.toBeNull();
    await page.unroute(SEND_MESSAGE_ROUTE);
    return captured!;
  }

  test('request context popover saves JSON per agent and persists across reloads', async ({ page }) => {
    await page.goto('/agents/test-agent/threads/new');
    await saveAgentRequestContext(page, '{"userId":"smoke-test-123"}');

    const stored = await page.evaluate(() => localStorage.getItem('mastra-request-context:agent:test-agent'));
    expect(stored).toContain('smoke-test-123');

    await page.reload();
    await page.getByRole('button', { name: 'Request context', exact: true }).click();
    const popover = page.getByRole('dialog').filter({ hasText: 'Request Context (JSON)' });
    await expect(popover.getByRole('textbox')).toContainText('smoke-test-123');

    // Scoped per entity: another agent does not inherit test-agent's context.
    await page.goto('/agents/helper-agent/threads/new');
    await page.getByRole('button', { name: 'Request context', exact: true }).click();
    const helperPopover = page.getByRole('dialog').filter({ hasText: 'Request Context (JSON)' });
    await expect(helperPopover.getByRole('textbox')).toBeVisible();
    await expect(helperPopover.getByRole('textbox')).not.toContainText('smoke-test-123');
  });

  test('request context is included in agent chat and cleared to empty after removal', async ({ page }) => {
    await page.goto('/agents/test-agent/threads/new');
    await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true');
    await saveAgentRequestContext(page, JSON.stringify({ tenantId: 'e2e-tenant-42', env: 'test' }));

    const rc = extractRequestContext(await captureNextSend(page, 'say hello'));
    expect(rc).toBeDefined();
    expect(rc!.tenantId).toBe('e2e-tenant-42');
    expect(rc!.env).toBe('test');

    await page.goto('/agents/test-agent/threads/new');
    await saveAgentRequestContext(page, '{}');

    // The app always sends the field; after clearing it must contain no keys.
    const rcAfter = extractRequestContext(await captureNextSend(page, 'say hi'));
    expect(rcAfter).toBeDefined();
    expect(Object.keys(rcAfter!)).toHaveLength(0);
  });
});
