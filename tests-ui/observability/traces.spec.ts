import { test, expect, Page } from '@playwright/test';
import { fillAndSend, waitForAssistantMessage } from '../helpers';

/**
 * Locate non-skeleton trace entries in the observability list.
 * Trace entries are <button class="data-list-row"> elements inside a grid container.
 * Each row has a Type cell ("Agent", "Workflow", "Scorer") and the root entity name.
 */
function traceEntries(page: Page) {
  return page.locator('button.data-list-row');
}

/** The trace detail drawer (Base UI dialog named "Trace details"). */
function traceDetails(page: Page) {
  return page.getByRole('dialog', { name: 'Trace details' });
}

test.describe('Observability', () => {
  // Self-contained tests that generate their own traces go first,
  // so subsequent tests can rely on traces existing in the database.

  test('traces appear after workflow run', async ({ page }) => {
    // Run a workflow to generate a fresh trace
    await page.goto('/workflows/sequential-steps/graph');
    await page.getByRole('textbox', { name: 'Name' }).first().fill('observability-test');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const lastNode = page.locator('[data-workflow-node]').last();
    await expect(lastNode).toHaveAttribute('data-workflow-step-status', 'success', { timeout: 10_000 });

    // Navigate to observability — the trace for the workflow we just ran
    // should appear in the list. Poll with reloads since trace indexing
    // may lag behind the workflow completion.
    await expect(async () => {
      await page.goto('/observability');
      await expect(traceEntries(page).filter({ hasText: 'sequential-steps' }).first()).toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 3_000] });
  });

  test('traces appear after agent chat', async ({ page }) => {
    test.slow();

    // Send a message to generate an agent trace
    await page.goto('/agents/test-agent/threads/new');
    await fillAndSend(page, 'Say hi');
    await waitForAssistantMessage(page);

    // Navigate to observability — an agent trace should appear.
    // Poll with reloads since trace indexing may lag behind the chat response.
    await expect(async () => {
      await page.goto('/observability');
      await expect(traceEntries(page).first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 3_000] });
  });

  // Tests below rely on traces already existing from the tests above
  // (and from any previous test suite runs).

  test('traces list page loads with trace entries', async ({ page }) => {
    await page.goto('/observability');

    await expect(page.getByRole('heading', { name: 'Traces', level: 1 })).toBeVisible();

    // Filters are a "Trace filters" group with an "Add filter" combobox.
    const filters = page.getByRole('group', { name: 'Trace filters' });
    await expect(filters.getByRole('combobox', { name: 'Add filter' })).toBeVisible();

    // At least one trace entry should exist (seeded by the tests above)
    await expect(traceEntries(page).first()).toBeVisible({ timeout: 10_000 });
  });

  test('filter traces by entity type', async ({ page }) => {
    await page.goto('/observability');
    await expect(traceEntries(page).first()).toBeVisible({ timeout: 10_000 });

    // Add filter is a two-step combobox: pick the field, then its value.
    await page.getByRole('combobox', { name: 'Add filter' }).click();
    await page.getByRole('option', { name: 'Primitive Type' }).click();
    await page.getByRole('option', { name: 'is', exact: true }).click();
    await page.getByRole('option', { name: 'Workflow', exact: true }).click();

    // The active filter is rendered as a chip and reflected in the URL.
    const filters = page.getByRole('group', { name: 'Trace filters' });
    await expect(filters.getByRole('combobox', { name: 'Value: Workflow' })).toBeVisible();
    await expect(page).toHaveURL(/rootEntityType=workflow_run/, { timeout: 5_000 });

    // Only workflow traces remain.
    await expect(traceEntries(page).first()).toBeVisible({ timeout: 10_000 });
    await expect(traceEntries(page).filter({ hasText: /Agent/ })).toHaveCount(0);
    await expect(traceEntries(page).filter({ hasText: /Workflow/ }).first()).toBeVisible();
  });

  test('click trace to open detail panel', async ({ page }) => {
    await page.goto('/observability');

    // Open a workflow trace (the newest entry may be an agent trace, whose
    // spans are named differently).
    const workflowTrace = traceEntries(page).filter({ hasText: /Workflow/ }).first();
    await expect(workflowTrace).toBeVisible({ timeout: 10_000 });
    await workflowTrace.click();

    // The trace detail panel opens as a "Trace details" dialog headed "Trace <id…>".
    await expect(traceDetails(page).getByRole('heading', { name: /^Trace [0-9a-f]+…?$/ })).toBeVisible({ timeout: 5_000 });

    // Span buttons should be visible in the timeline
    const spanButton = page.getByRole('button', { name: /workflow (run|step):/ });
    await expect(spanButton.first()).toBeVisible();

    // Close the panel
    await page.getByRole('button', { name: 'Close Panel' }).first().click();
    await expect(traceDetails(page).getByRole('heading', { name: /^Trace [0-9a-f]+…?$/ })).not.toBeVisible();
  });

  test('span inspection within trace', async ({ page }) => {
    // Find a workflow trace that has multiple spans
    await page.goto('/observability');
    const workflowTrace = traceEntries(page).filter({ hasText: 'sequential-steps' }).first();
    await expect(workflowTrace).toBeVisible({ timeout: 10_000 });
    await workflowTrace.click();
    await expect(traceDetails(page).getByRole('heading', { name: /^Trace [0-9a-f]+…?$/ })).toBeVisible({ timeout: 5_000 });

    // Click a step span in the timeline
    const stepSpan = page.getByRole('button', { name: /workflow step:/ });
    await expect(stepSpan.first()).toBeVisible({ timeout: 5_000 });
    await stepSpan.first().click();

    // The span detail panel opens inside the same dialog headed "Span <id…>".
    await expect(traceDetails(page).getByRole('heading', { name: /^Span [0-9a-f]+…?$/ })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('tab', { name: 'Details' })).toBeVisible();
  });
});
