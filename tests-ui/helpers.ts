import { expect, Page } from '@playwright/test';

/**
 * Fill the chat input and click Send.
 * Waits for the input to be editable before typing, and for Send to be enabled before clicking.
 */
export async function fillAndSend(page: Page, message: string) {
  const chatInput = page.getByPlaceholder('Enter your message...');
  await expect(chatInput).toBeEditable({ timeout: 5_000 });
  await chatInput.click();
  await chatInput.pressSequentially(message, { delay: 10 });
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * Open the agent "Config" side panel (the former Overview page content: tools,
 * workflows, sub-agents, memory, system prompt). The header toggle is a pressed
 * button whose open state persists across navigations, so only click it when the
 * panel is not already mounted. Returns the panel locator.
 */
export async function openAgentConfigPanel(page: Page) {
  const panel = page.getByTestId('agent-overview-panel');
  const toggle = page.getByTestId('agent-overview-panel-toggle');
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  if (!(await panel.isVisible())) {
    await toggle.click();
  }
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('heading', { name: 'Config', level: 2 })).toBeVisible();
  return panel;
}

/**
 * Wait for the assistant message to appear in the thread.
 * Uses data-message-id (renamed from data-message-index in Studio) to find
 * the last message in the thread.
 */
export async function waitForAssistantMessage(page: Page, timeout = 30_000) {
  const thread = page.getByTestId('thread-wrapper');
  // The assistant may emit multiple messages (e.g. tool calls then final text).
  // Grab the last assistant message so assertions match the final response.
  const assistantMsg = thread.locator('[data-message-id]').last();
  await expect(assistantMsg).toBeVisible({ timeout });
  return assistantMsg;
}
