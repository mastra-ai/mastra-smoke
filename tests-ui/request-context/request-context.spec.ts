import { test, expect } from '@playwright/test';

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
  test('request context page displays editor and saves JSON', async ({ page }) => {
    await page.goto('/request-context');

    // Page heading
    await expect(page.getByRole('heading', { name: 'Request Context', level: 1 })).toBeVisible();

    // Label
    await expect(page.getByText('Request Context (JSON)')).toBeVisible();

    // CodeMirror editor with default content
    const editor = page.getByRole('textbox').and(page.locator('.cm-content'));
    await expect(editor).toBeVisible();

    // Save button
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    // Replace editor content with valid JSON
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('{"userId":"smoke-test-123"}');

    // Click Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Expect success toast
    await expect(page.getByText('Request context saved successfully')).toBeVisible({ timeout: 5_000 });

    // Reload and verify persistence (stored in localStorage via zustand)
    await page.reload();
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('smoke-test-123');
  });

  test('request context is included in agent chat and cleared to empty after removal', async ({ page }) => {
    const contextPayload = { tenantId: 'e2e-tenant-42', env: 'test' };

    // 1. Set request context via the Request Context page
    await page.goto('/request-context');
    const editor = page.getByRole('textbox').and(page.locator('.cm-content'));
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(JSON.stringify(contextPayload));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Request context saved successfully')).toBeVisible({ timeout: 5_000 });

    // 2. Navigate to agent chat and intercept the send-message call
    await page.goto('/agents/test-agent/threads/new');
    await expect(page.getByTestId('thread-sidebar-back')).toHaveAccessibleName('Back to Test Agent');

    // Intercept the POST to the agent send-message endpoint. The streamed request body
    // is only readable via route.request().postData() during interception — passive
    // request listeners see an empty body.
    let capturedBody: SendMessageBody | null = null;
    await page.route(SEND_MESSAGE_ROUTE, async (route) => {
      const request = route.request();
      try {
        capturedBody = JSON.parse(request.postData() ?? '{}');
      } catch {
        capturedBody = null;
      }
      // Let the request go through
      await route.continue();
    });

    // Send a message
    const chatInput = page.getByRole('textbox', { name: /message/i });
    await chatInput.fill('say hello');
    await chatInput.press('Enter');

    // Wait for the send-message request to be captured
    await expect(async () => {
      expect(capturedBody).not.toBeNull();
    }).toPass({ timeout: 30_000 });

    // Verify requestContext was included in the body
    const rc = extractRequestContext(capturedBody);
    expect(rc).toBeDefined();
    expect(rc!.tenantId).toBe('e2e-tenant-42');
    expect(rc!.env).toBe('test');

    // 3. Remove the request context via the UI
    await page.unroute(SEND_MESSAGE_ROUTE);
    await page.goto('/request-context');
    const editorClear = page.getByRole('textbox').and(page.locator('.cm-content'));
    await expect(editorClear).toBeVisible();

    // Focus and select all content, then replace with empty object
    await editorClear.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('{}');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Request context saved successfully')).toBeVisible({ timeout: 5_000 });

    // 4. Navigate to agent chat again and verify requestContext is empty
    let capturedBodyAfter: SendMessageBody | null = null;
    await page.goto('/agents/test-agent/threads/new');
    await expect(page.getByTestId('thread-sidebar-back')).toHaveAccessibleName('Back to Test Agent');

    await page.route(SEND_MESSAGE_ROUTE, async (route) => {
      const request = route.request();
      try {
        capturedBodyAfter = JSON.parse(request.postData() ?? '{}');
      } catch {
        capturedBodyAfter = null;
      }
      await route.continue();
    });

    const chatInput2 = page.getByRole('textbox', { name: /message/i });
    await chatInput2.fill('say hi');
    await chatInput2.press('Enter');

    await expect(async () => {
      expect(capturedBodyAfter).not.toBeNull();
    }).toPass({ timeout: 30_000 });

    // RequestContext should be an empty object — the app always sends the field,
    // but after clearing via the UI it should contain no keys
    const rcAfter = extractRequestContext(capturedBodyAfter);
    expect(rcAfter).toBeDefined();
    expect(Object.keys(rcAfter!)).toHaveLength(0);
  });
});
