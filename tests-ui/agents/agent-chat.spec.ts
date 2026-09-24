import { test, expect, Page } from '@playwright/test';
import { fillAndSend, openAgentConfigPanel, waitForAssistantMessage } from '../helpers';

/** Wait for the agent's thread navigation, not the global app sidebar. */
async function waitForThreadSidebar(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Threads', exact: true }).getByRole('link', { name: 'New Chat' })).toBeVisible({ timeout: 10_000 });
}

/**
 * Open the Model settings dialog. Studio moved model settings from a right-panel
 * tab to a composer button that opens a popover dialog containing the chat-method
 * radios (Generate / Stream subscription (default) / Stream / Network) and an
 * Advanced Settings button.
 */
async function openModelSettings(page: Page) {
  await page.getByRole('button', { name: 'Model settings' }).click();
  await expect(page.getByRole('radio', { name: 'Generate' })).toBeVisible({ timeout: 5_000 });
}

test.describe('Agent Chat', () => {
  let pageErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
  });
  test.afterEach(() => {
    expect(pageErrors, 'unexpected browser errors').toEqual([]);
  });

  test('agent page shows config metadata and opens on a new thread', async ({ page }) => {
    // The dedicated overview route was folded into the agent page: /overview
    // redirects to the Chat tab and the metadata lives in the Config side panel.
    await page.goto('/agents/test-agent/overview');
    await expect(page).toHaveURL('/agents/test-agent/threads/new');

    await expect(page).toHaveTitle(/Mastra Studio/);
    await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('combobox', { name: 'Switch agent' }))
      .toHaveText('Test Agent');
    await expect(page.getByRole('textbox', { name: 'Enter your message...' })).toBeEditable();

    // The capability strip summarises what is attached to the agent. It lives in the
    // left threads panel, which now opens collapsed behind "Expand panel".
    await page.getByRole('button', { name: 'Expand panel' }).click();
    await expect(page.getByRole('navigation', { name: 'Threads' })).toBeVisible();
    await page.getByRole('button', { name: 'Show capability details' }).click();
    await expect(page.getByRole('link', { name: 'Tools: 2' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Memory: On' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sub-agents: Off' })).toBeVisible();

    // Config panel lists attached tools, memory configuration and the system prompt.
    const config = await openAgentConfigPanel(page);
    await expect(config.getByRole('heading', { name: 'Tools 2', level: 3 })).toBeVisible();
    await expect(config.getByRole('link', { name: 'calculator', exact: true })).toBeVisible();
    await expect(config.getByRole('link', { name: 'string-transform', exact: true })).toBeVisible();
    await expect(config.getByRole('heading', { name: 'Memory', level: 3 })).toBeVisible();
    // Memory renders as a definition list: Status → Enabled, Last Messages → 20.
    const memory = config.locator('section').filter({
      has: page.getByRole('heading', { name: 'Memory', exact: true, level: 3 }),
    });
    await expect(memory.locator('dl')).toBeVisible();
    await expect(memory.locator('dt')).toHaveText([/Status/, /Last Messages/, /Auto-generate Titles/]);
    await expect(memory.locator('dd')).toHaveText([/Enabled/, /^20$/, /Disabled/]);
    await expect(config.getByRole('heading', { name: 'System Prompt', level: 3 })).toBeVisible();
    await expect(config.getByText('You are a helpful test agent.')).toBeVisible();
  });

  test('send message and receive streamed response', async ({ page }) => {
    await page.goto('/agents/test-agent/threads/new');

    await fillAndSend(page, 'What is 2 + 2? Reply with just the number, nothing else.');

    // Wait for navigation to the thread URL
    await expect(page).toHaveURL(/\/threads\/(?!new)/, { timeout: 45_000 });

    // Verify our message appears in the thread
    const thread = page.getByTestId('thread-wrapper');
    await expect(thread.getByText('What is 2 + 2?')).toBeVisible({ timeout: 10_000 });

    // Wait for the assistant response and verify it contains "4"
    const assistantMsg = await waitForAssistantMessage(page);
    await expect(assistantMsg).toContainText('4', { timeout: 30_000 });
  });

  test('send message with generate mode', async ({ page }) => {
    await page.goto('/agents/test-agent/threads/new');

    // Switch to Generate mode.
    // Model settings is now a composer button that opens a popover dialog. The
    // chat-method radios are a base-ui radio group: a visible <span role="radio">
    // plus a hidden <input type="radio">, both associated with the same label.
    // getByLabel('Generate') would match both and trip strict-mode, so target the
    // role explicitly. Close the popover (Escape) before sending.
    await openModelSettings(page);
    await page.getByRole('radio', { name: 'Generate' }).click();
    await page.keyboard.press('Escape');

    await fillAndSend(page, 'Say the word hello and nothing else.');

    // Wait for navigation
    await expect(page).toHaveURL(/\/threads\/(?!new)/, { timeout: 45_000 });

    // Wait for the assistant response and verify it contains "hello"
    const assistantMsg = await waitForAssistantMessage(page);
    await expect(assistantMsg).toContainText(/hello/i, { timeout: 30_000 });
  });

  test('model settings persist after reload', async ({ page }) => {
    // Model settings are stored per thread (mastra-thread-preferences-[agent, thread]).
    // /threads/new mints a fresh provisional thread on every load, so persistence
    // can only be observed on a real thread — create one first.
    await page.goto('/agents/test-agent/threads/new');
    await fillAndSend(page, 'Hi');
    await expect(page).toHaveURL(/\/threads\/(?!new)/, { timeout: 45_000 });
    await waitForAssistantMessage(page);
    const threadUrl = page.url();

    // Open the Model settings popover dialog
    await openModelSettings(page);

    // The chat-method radios are base-ui radios: visible <span role="radio"> +
    // hidden <input type="radio"> share the label, so getByLabel matches both.
    // Target by role to avoid strict-mode violations. The default selection is
    // now "Stream subscription (default)". Use exact to disambiguate from the
    // plain "Stream" option.
    await expect(
      page.getByRole('radio', { name: 'Stream subscription (default)' }),
    ).toHaveAttribute('aria-checked', 'true');

    // Switch to Generate mode and change Max Steps (in the nested Advanced dialog)
    await page.getByRole('radio', { name: 'Generate' }).click();
    await page.getByRole('button', { name: 'Advanced Settings' }).click();
    await page.getByLabel('Max Steps').fill('3');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Reload the same thread and verify both Generate mode and Max Steps persisted
    await page.reload();
    await expect(page).toHaveURL(threadUrl);
    await openModelSettings(page);
    await expect(page.getByRole('radio', { name: 'Generate' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Advanced Settings' }).click();
    await expect(page.getByLabel('Max Steps')).toHaveValue('3');
  });

  test('new chat button navigates to fresh thread', async ({ page }) => {
    await page.goto('/agents/test-agent/threads/new');

    // Send a message first so we're on a real thread URL
    await fillAndSend(page, 'Hi');
    await expect(page).toHaveURL(/\/threads\/(?!new)/, { timeout: 45_000 });

    // Now click New Chat and verify we get a fresh thread
    const newChatLink = page.getByRole('link', { name: 'New Chat' });
    await expect(newChatLink).toBeVisible();
    await newChatLink.click();
    await expect(page).toHaveURL(/\/threads\/new/);

    // Verify the chat input is empty and ready
    await expect(page.getByPlaceholder('Enter your message...')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your message...')).toBeEmpty();
  });

  test('thread sidebar lists previous conversations', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/agents/test-agent/threads/new');

    // Send a message to create a thread
    await fillAndSend(page, 'Hello from thread sidebar test');
    await expect(page).toHaveURL(/\/threads\/(?!new)/, { timeout: 45_000 });
    await waitForAssistantMessage(page);

    // Expand the thread sidebar if collapsed
    await waitForThreadSidebar(page);

    // Require the exact thread we created, not an unrelated navigation link.
    const threadPath = new URL(page.url()).pathname;
    const threads = page.getByRole('navigation', { name: 'Threads', exact: true });
    await expect(threads.locator(`a[href="${threadPath}"]`)).toBeVisible({ timeout: 10_000 });
  });

  test('click previous thread to reload it', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/agents/test-agent/threads/new');

    // Send a message to create the first thread
    await fillAndSend(page, 'First thread message for reload test');
    await expect(page).toHaveURL(/\/threads\/(?!new)/, { timeout: 45_000 });
    await waitForAssistantMessage(page);
    const firstThreadUrl = page.url();

    // Start a new chat to create a second context
    await page.getByRole('link', { name: 'New Chat' }).click();
    await expect(page).toHaveURL(/\/threads\/new/);

    // Expand the thread sidebar if collapsed
    await waitForThreadSidebar(page);

    const threads = page.getByRole('navigation', { name: 'Threads', exact: true });
    const previousThread = threads.locator(`a[href="${new URL(firstThreadUrl).pathname}"]`);
    await expect(previousThread).toBeVisible({ timeout: 10_000 });
    await previousThread.click();

    // Should navigate back to the exact same thread URL
    await expect(page).toHaveURL(firstThreadUrl, { timeout: 10_000 });

    // The previous user message should be visible in the reloaded thread
    // Scope to the first message (user) to avoid matching the assistant response
    // which may echo back the same text (causes strict mode violation)
    // Messages are tagged with data-message-id (ids, not positional indexes),
    // so grab the first message element to scope to the user message.
    const userMessage = page.getByTestId('thread-wrapper').locator('[data-message-id]').first();
    await expect(userMessage.getByText('First thread message for reload test')).toBeVisible({ timeout: 10_000 });
  });

  test('tool call displayed in chat message', async ({ page }) => {
    test.slow();
    await page.goto('/agents/test-agent/threads/new');

    // Ask the agent to use the calculator tool explicitly
    await fillAndSend(page, 'Use the calculator tool to add 5 and 3. You must call the calculator tool.');

    // Wait for navigation to thread
    await expect(page).toHaveURL(/\/threads\/(?!new)/, { timeout: 45_000 });

    // Wait for the tool badge to appear in the chat
    const toolBadge = page.getByTestId('tool-badge');
    await expect(toolBadge.first()).toBeVisible({ timeout: 30_000 });

    // Studio formats tool IDs as display names in chat badges.
    await expect(toolBadge.first()).toContainText(/calculator/i);

    // Click the tool badge to expand it and verify the rendered arguments.
    await toolBadge.first().locator('button').first().click();
    await expect(toolBadge.first()).toContainText('"operation": "add"');
  });

  test('agent tabs switch between chat and traces', async ({ page }) => {
    await page.goto('/agents/test-agent/threads/new');
    const tabs = page.getByRole('tablist').filter({ has: page.getByRole('tab', { name: 'Chat', exact: true }) });
    await expect(tabs.getByRole('tab')).toHaveText(['Chat', 'Traces']);
    await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Traces', exact: true }).click();
    await expect(page).toHaveURL(/\/agents\/test-agent\/traces\?rootEntityType=agent&filterEntityId=test-agent/);
    await expect(page.getByRole('tab', { name: 'Traces', exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await expect(page).toHaveURL('/agents/test-agent/threads/new');
    await expect(page.getByRole('textbox', { name: 'Enter your message...' })).toBeEditable();
  });

  test('approval agent triggers tool approval flow', async ({ page }) => {
    test.slow();
    await page.goto('/agents/approval-agent/threads/new');

    await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('combobox')).toHaveText('Approval Agent');

    // Ask the agent to greet someone — this should trigger the needs-approval tool
    await fillAndSend(page, 'Please greet John');

    // The tool badge for needs-approval should appear, auto-expanded because of approval metadata.
    // Scope to the chat thread so we don't match the overview panel's tool badges.
    const thread = page.getByTestId('thread-wrapper');
    const toolBadge = thread.getByTestId('tool-badge');
    await expect(toolBadge.first()).toBeVisible({ timeout: 30_000 });
    await expect(toolBadge.first().getByRole('button', { name: 'Needs approval' })).toBeVisible();

    // "Approval required" text should be visible (badge auto-expands for approval tools)
    await expect(page.getByText('Approval required')).toBeVisible({ timeout: 10_000 });

    // Approve and Decline buttons should be visible
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Decline' })).toBeVisible();

    // Click Approve
    await page.getByRole('button', { name: 'Approve' }).click();

    // After approval, the expanded badge should render the greeting result.
    await expect(toolBadge.first()).toContainText('"greeting": "Hello, John!"', { timeout: 30_000 });
  });

  test('agent config panel shows correct tools list', async ({ page }) => {
    await page.goto('/agents/test-agent/threads/new');
    let config = await openAgentConfigPanel(page);
    await expect(config.getByRole('heading', { name: 'Tools 2', level: 3 })).toBeVisible();
    await expect(config.getByRole('link', { name: 'calculator', exact: true })).toBeVisible();
    await expect(config.getByRole('link', { name: 'string-transform', exact: true })).toBeVisible();

    await page.goto('/agents/approval-agent/threads/new');
    config = await openAgentConfigPanel(page);
    await expect(config.getByRole('heading', { name: 'Tools 1', level: 3 })).toBeVisible();
    await expect(config.getByRole('link', { name: 'needs-approval', exact: true })).toBeVisible();
  });
});
