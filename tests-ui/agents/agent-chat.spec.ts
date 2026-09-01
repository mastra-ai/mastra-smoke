import { test, expect, Page } from '@playwright/test';
import { fillAndSend, waitForAssistantMessage } from '../helpers';

/** Wait for the standalone thread sidebar to load. */
async function waitForThreadSidebar(page: Page) {
  await expect(page.getByRole('link', { name: 'New Chat' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 10_000 });
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
  test('agent overview shows metadata and links to a new thread', async ({ page }) => {
    await page.goto('/agents/test-agent/overview');

    await expect(page).toHaveTitle(/Mastra Studio/);
    await expect(page.getByTestId('agent-settings-view')).toBeVisible();
    await expect(page.getByTestId('agent-view-header-new-chat')).toHaveAttribute(
      'href',
      '/agents/test-agent/threads/new',
    );

    // Overview metadata lists attached tools and the system prompt.
    await expect(page.getByRole('link', { name: 'calculator' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'string-transform' })).toBeVisible();
    await expect(page.getByText('You are a helpful test agent.')).toBeVisible();

    // Memory configuration is now part of the overview.
    await expect(page.getByRole('heading', { name: 'Memory' })).toBeVisible();
    await expect(page.getByText('Memory Enabled')).toBeVisible();
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
    await page.goto('/agents/test-agent/threads/new');

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

    // Reload and verify both Generate mode and Max Steps persisted
    await page.reload();
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

    // At least one thread entry should appear (the one we just created)
    // Thread entries are links inside ThreadItem components that are NOT "New Chat"
    const leftPanel = page.getByRole('navigation', { name: 'Main' });
    const threadEntries = leftPanel.locator('a').filter({ hasNotText: 'New Chat' });
    await expect(threadEntries.first()).toBeVisible({ timeout: 10_000 });
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

    // Click the first previous thread entry (not "New Chat")
    const leftPanel = page.getByRole('navigation', { name: 'Main' });
    const threadEntries = leftPanel.locator('a').filter({ hasNotText: 'New Chat' });
    await expect(threadEntries.first()).toBeVisible({ timeout: 10_000 });
    await threadEntries.first().click();

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

  test('new thread links back to the agent overview', async ({ page }) => {
    await page.goto('/agents/test-agent/threads/new');

    const backLink = page.getByTestId('thread-sidebar-back');
    await expect(backLink).toHaveAccessibleName('Back to Test Agent');
    await expect(backLink).toHaveAttribute('href', '/agents/test-agent/overview');
  });

  test('approval agent triggers tool approval flow', async ({ page }) => {
    test.slow();
    await page.goto('/agents/approval-agent/threads/new');

    // The standalone thread sidebar identifies the active agent.
    await expect(page.getByTestId('thread-sidebar-back')).toHaveAccessibleName('Back to Approval Agent');

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

  test('agent overview shows correct tools list', async ({ page }) => {
    await page.goto('/agents/test-agent/overview');

    await expect(page.getByRole('link', { name: 'calculator' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'string-transform' })).toBeVisible();

    await page.goto('/agents/approval-agent/overview');
    await expect(page.getByRole('link', { name: 'needs-approval' })).toBeVisible();
  });
});
