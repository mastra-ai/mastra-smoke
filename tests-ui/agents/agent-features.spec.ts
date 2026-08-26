import { test, expect, Page } from '@playwright/test';
import { fillAndSend, waitForAssistantMessage } from '../helpers';

/**
 * Open the Model settings popover dialog. Studio moved model settings from a
 * right-panel tab to a composer button that opens a dialog containing the
 * chat-method radios, sliders, Reset and Advanced Settings.
 */
async function openModelSettings(page: Page) {
  await page.getByRole('button', { name: 'Model settings' }).click();
  await expect(page.getByRole('radio', { name: 'Generate' })).toBeVisible({ timeout: 5_000 });
}

test.describe('Agent Features', () => {
  test('model settings tab shows controls and persists chat method', async ({ page }) => {
    await page.goto('/agents/test-agent/chat/new');

    // Open the Model settings dialog
    await openModelSettings(page);

    // Chat Method radio group
    await expect(page.getByRole('radio', { name: 'Generate' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Stream subscription (default)' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Network' })).toBeVisible();

    // Stream subscription should be selected by default
    await expect(page.getByRole('radio', { name: 'Stream subscription (default)' })).toBeChecked();

    // Require Tool Approval checkbox
    await expect(page.getByRole('checkbox')).toBeVisible();

    // Temperature and Top P sliders
    await expect(page.getByText('Temperature')).toBeVisible();
    await expect(page.getByText('Top P')).toBeVisible();

    // Advanced Settings collapsible
    await expect(page.getByRole('button', { name: 'Advanced Settings' })).toBeVisible();

    // Reset button
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();

    // Switch to Generate and verify it sticks
    await page.getByRole('radio', { name: 'Generate' }).click();
    await expect(page.getByRole('radio', { name: 'Generate' })).toBeChecked();
  });

  test('tracing options shows JSON editor via Run options', async ({ page }) => {
    await page.goto('/agents/test-agent/chat/new');

    // Tracing Options moved from a tab to the "Run options" composer button
    await page.getByRole('button', { name: 'Run options' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The dialog shows "Tracing Options" label and contains a JSON editor
    await expect(dialog.getByText('Tracing Options')).toBeVisible();
    await expect(dialog.getByRole('textbox').first()).toBeVisible();
  });

  test('model settings: network mode enabled only with sub-agents and memory', async ({ page }) => {
    // networkAgent has both memory and sub-agents — Network should be enabled
    await page.goto('/agents/network-agent/chat/new');
    await openModelSettings(page);

    const networkRadio = page.getByRole('radio', { name: 'Network' });
    await expect(networkRadio).toBeVisible();
    await expect(networkRadio).toBeEnabled();

    // testAgent has memory but no sub-agents — Network should be disabled
    await page.goto('/agents/test-agent/chat/new');
    await openModelSettings(page);

    const disabledNetworkRadio = page.getByRole('radio', { name: 'Network' });
    await expect(disabledNetworkRadio).toBeVisible();
    await expect(disabledNetworkRadio).toBeDisabled();
  });

  test('model settings: advanced settings expand and show fields', async ({ page }) => {
    await page.goto('/agents/test-agent/chat/new');
    await openModelSettings(page);

    // Expand advanced settings
    await page.getByRole('button', { name: 'Advanced Settings' }).click();

    // Verify advanced fields are visible
    await expect(page.getByText('Frequency Penalty')).toBeVisible();
    await expect(page.getByText('Presence Penalty')).toBeVisible();
    await expect(page.getByText('Max Tokens')).toBeVisible();
    await expect(page.getByText('Max Steps')).toBeVisible();
  });

  test('agent selector reflects current agent and switching agents updates it', async ({ page }) => {
    await page.goto('/agents/test-agent/chat/new');

    // The agent selector combobox in the chat header reflects the active agent.
    // Studio moved the picker to a breadcrumb-style combobox whose option list
    // is a portaled dialog that does not surface as role=option under test, so
    // we exercise switching via the agents list (the supported navigation path)
    // and assert the selector reflects the newly selected agent.
    await expect(page.getByRole('combobox').filter({ hasText: 'Test Agent' })).toBeVisible();

    // Switch to a different agent via the agents list.
    await page.goto('/agents');
    await page.getByRole('link', { name: /^Helper Agent\b/ }).click();

    // Lands on the helper agent page with its heading...
    await expect(page).toHaveURL(/\/agents\/helper-agent/);
    await expect(page.locator('h2:has-text("Helper Agent")')).toBeVisible();

    // ...and the chat-header selector now reflects Helper Agent.
    await expect(page.getByRole('combobox').filter({ hasText: 'Helper Agent' })).toBeVisible();
  });

  test('network-agent overview shows sub-agents section', async ({ page }) => {
    await page.goto('/agents/network-agent/chat/new');

    // Overview content is behind the agent-view-header-toggle
    await expect(page.locator('h2:has-text("Network Agent")')).toBeVisible();
    await page.getByTestId('agent-view-header-toggle').click();

    // Sub-agents section with "Agents" heading
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();

    // Helper Agent should be listed as a sub-agent
    await expect(page.getByText('Helper Agent')).toBeVisible();

    // Click to navigate to the sub-agent
    await page.getByRole('link', { name: 'Helper Agent' }).click();
    await expect(page).toHaveURL(/\/agents\/helper-agent/);
    await expect(page.locator('h2:has-text("Helper Agent")')).toBeVisible();
  });

  test('agents list shows all agents with correct attached entities', async ({ page }) => {
    await page.goto('/agents');

    // All six fixture agents should appear as links
    await expect(page.getByRole('link', { name: /^Test Agent\b/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Helper Agent\b/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Network Agent\b/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Approval Agent\b/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Workflow Agent\b/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Observational Agent\b/ })).toBeVisible();

    // Attached-entity counts render as sibling buttons whose accessible name
    // spells out the entity type and count, e.g. "Show 1 agent for Network Agent".
    // Network Agent has 1 sub-agent (helperAgent)
    await expect(
      page.getByRole('button', { name: 'Show 1 agent for Network Agent' }),
    ).toHaveText('1');

    // Helper Agent has 1 tool
    await expect(
      page.getByRole('button', { name: 'Show 1 tool for Helper Agent' }),
    ).toHaveText('1');

    // Workflow Agent has 1 workflow
    await expect(
      page.getByRole('button', { name: 'Show 1 workflow for Workflow Agent' }),
    ).toHaveText('1');

    // Test Agent has 2 tools (calculator, string-transform)
    await expect(
      page.getByRole('button', { name: 'Show 2 tools for Test Agent' }),
    ).toHaveText('2');
  });

  test('network-agent delegates to helper-agent via sub-agent call', async ({ page }) => {
    await page.goto('/agents/network-agent/chat/new');

    // Stream is default — send a message that triggers delegation to the helper sub-agent
    await fillAndSend(page, 'Ask your helper agent to say the word "mango" and nothing else.');

    // Wait for navigation to thread URL
    await expect(page).toHaveURL(/\/chat\/(?!new)/, { timeout: 45_000 });

    // The sub-agent call should render as an AgentBadge in the chat thread
    const thread = page.getByTestId('thread-wrapper');
    const agentBadge = thread.getByTestId('agent-badge');
    await expect(agentBadge).toBeVisible({ timeout: 30_000 });

    // The badge should show the helper-agent id
    await expect(agentBadge).toContainText(/helper-agent/i);

    // Studio no longer renders the delegated response inside the agent badge;
    // verify the result where it is surfaced in the final assistant message.
    const assistantMsg = await waitForAssistantMessage(page);
    await expect(assistantMsg).toBeVisible({ timeout: 30_000 });
    await expect(assistantMsg).toContainText(/mango/i);
  });

  test('workflow-agent triggers workflow and workflow badge renders in chat', async ({ page }) => {
    await page.goto('/agents/workflow-agent/chat/new');

    // Verify the overview shows the workflow is attached (behind header toggle)
    await page.getByTestId('agent-view-header-toggle').click();
    await expect(page.getByRole('link', { name: 'sequential-steps' })).toBeVisible();
    // Collapse overview so it doesn't interfere with the chat interaction
    await page.getByTestId('agent-view-header-toggle').click();

    // Send a message that triggers the workflow
    await fillAndSend(page, 'Greet someone named Alice');

    // Wait for navigation to thread URL
    await expect(page).toHaveURL(/\/chat\/(?!new)/, { timeout: 45_000 });

    // The workflow call should render as a WorkflowBadge in the chat thread
    const thread = page.getByTestId('thread-wrapper');
    const workflowBadge = thread.getByTestId('workflow-badge');
    await expect(workflowBadge).toBeVisible({ timeout: 30_000 });

    // The badge title should show the workflow name
    await expect(workflowBadge).toContainText(/sequential/i);

    // Workflow badge starts expanded — verify navigation links and the workflow graph
    await expect(workflowBadge.getByRole('link', { name: 'Go to workflow' })).toBeVisible();

    // The graph should render step nodes from the sequential-steps workflow
    await expect(workflowBadge.getByText('add-greeting')).toBeVisible();
    await expect(workflowBadge.getByText('add-farewell')).toBeVisible();
    await expect(workflowBadge.getByText('combine-messages')).toBeVisible();

    // The final assistant response should contain the workflow's combined output.
    // sequential-steps produces "Hello, <name>! Goodbye, <name>!" — assert both
    // halves to prove the result came from the workflow, not a generic LLM response.
    const assistantMsg = await waitForAssistantMessage(page);
    await expect(assistantMsg).toBeVisible({ timeout: 30_000 });
    await expect(assistantMsg).toContainText(/Hello,?\s*Alice/i);
    await expect(assistantMsg).toContainText(/Goodbye,?\s*Alice/i);
  });
});
