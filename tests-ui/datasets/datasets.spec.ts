import { test, expect, type Page } from '@playwright/test';

async function expectDatasetLoaded(page: Page, datasetName: string | RegExp) {
  await expect(page.getByRole('heading', { name: 'Dataset', level: 1, exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: datasetName, exact: true })).toBeVisible({ timeout: 10_000 });
}

test.describe('Datasets', () => {
  test('datasets list page shows create button and heading', async ({ page }) => {
    await page.goto('/datasets');

    await expect(page.getByRole('heading', { name: 'Datasets', level: 1 })).toBeVisible();
    // The populated list says "Create a dataset" while the empty state says "Create Dataset".
    await expect(page.getByRole('button', { name: /Create (a )?dataset/i }).first()).toBeVisible();
  });

  test('create dataset and verify it appears in list', async ({ page }) => {
    await page.goto('/datasets');

    // Dataset creation now uses a dedicated page instead of a dialog.
    await page.getByRole('button', { name: /Create (a )?dataset/i }).first().click();
    await expect(page).toHaveURL(/\/datasets\/new$/);
    await expect(page.getByRole('heading', { name: 'Create new dataset' }).first()).toBeVisible();

    const submitBtn = page.getByRole('button', { name: 'Create Dataset' });
    await expect(submitBtn).toBeDisabled();

    await page.getByRole('textbox', { name: 'Name (required)' }).fill('E2E Test Dataset');
    await page.getByRole('textbox', { name: 'Description' }).fill('Created by smoke tests');

    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();
    await expect(page).toHaveURL(/\/datasets\/[^/]+$/, { timeout: 10_000 });

    // Reload the page to ensure the new dataset is visible in the list
    await page.goto('/datasets');

    // Dataset should appear in the list
    await expect(page.getByRole('link', { name: /E2E Test Dataset/ }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Created by smoke tests').first()).toBeVisible();
  });

  test('add item to dataset and view its detail', async ({ page, request }) => {
    // Create dataset via API
    const createRes = await request.post('/api/datasets', {
      data: { name: 'Items Test Dataset', description: 'For item tests' },
    });
    expect(createRes.ok()).toBeTruthy();
    const dataset = await createRes.json();
    const datasetId = dataset.id;

    // Navigate to dataset detail
    await page.goto(`/datasets/${datasetId}`);
    await expectDatasetLoaded(page, 'Items Test Dataset');

    // Should show empty items tab initially — the single-item action should be present.
    await expect(page.getByRole('button', { name: 'Add Single Item' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Single Item' }).click();
    await expect(page.getByRole('dialog', { name: 'Add Item' })).toBeVisible();

    // The dialog has textbox editors for Input and Ground Truth
    const dialog = page.getByRole('dialog', { name: 'Add Item' });
    const inputEditor = dialog.getByRole('textbox').first();
    await inputEditor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('{"prompt": "Hello world"}');

    // Fill Ground Truth editor — second textbox
    const gtEditor = dialog.getByRole('textbox').nth(1);
    await gtEditor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('{"response": "Hi there"}');

    // Submit
    await dialog.getByRole('button', { name: 'Add Item' }).click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Item should appear in the list
    await expect(page.getByText('"Hello world"')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('"Hi there"')).toBeVisible();

    // Click the item button to open detail panel
    await page.getByRole('button', { name: /Hello world/ }).click();

    // Detail panel should show the item heading plus Input / Ground Truth labels.
    // "Input" / "Ground Truth" also appear as table column headers, so scope the
    // label assertions to the detail panel (the last occurrence, rendered after
    // the items table) to avoid ambiguous matches.
    await expect(page.getByRole('heading', { name: /^Item #/, level: 3 })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Input', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Ground Truth', { exact: true }).last()).toBeVisible();

    // Clean up via API
    await request.delete(`/api/datasets/${datasetId}`);
  });

  test('edit dataset name and description', async ({ page, request }) => {
    // Create dataset via API
    const createRes = await request.post('/api/datasets', {
      data: { name: 'Before Edit', description: 'Old description' },
    });
    expect(createRes.ok()).toBeTruthy();
    const dataset = await createRes.json();
    const datasetId = dataset.id;

    await page.goto(`/datasets/${datasetId}`);
    await expectDatasetLoaded(page, 'Before Edit');

    // Open actions menu → Edit Dataset
    await page.getByRole('button', { name: 'Dataset actions menu' }).first().click();
    await page.getByRole('menuitem', { name: 'Edit Dataset' }).click();

    // Dataset editing now uses a dedicated page instead of a dialog.
    await expect(page).toHaveURL(new RegExp(`/datasets/${datasetId}/edit$`));
    await expect(page.getByRole('heading', { name: 'Edit dataset' }).first()).toBeVisible();

    const nameInput = page.getByRole('textbox', { name: 'Name (required)' });
    await expect(nameInput).toHaveValue('Before Edit');

    await nameInput.fill('After Edit');
    await page.getByRole('textbox', { name: 'Description' }).fill('New description');

    const patchPromise = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes(`/api/datasets/${datasetId}`),
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: 'Save Changes' }).click();
    expect((await patchPromise).ok()).toBeTruthy();

    // Saving does not consistently navigate away from the dedicated edit page.
    // Reload the detail route to verify the persisted values independently.
    await page.goto(`/datasets/${datasetId}`);
    await expectDatasetLoaded(page, 'After Edit');

    // Clean up
    await request.delete(`/api/datasets/${datasetId}`);
  });

  test('edit item input and verify update', async ({ page, request }) => {
    // Create dataset + item via API
    const createRes = await request.post('/api/datasets', {
      data: { name: 'Edit Item Dataset', description: 'For item editing' },
    });
    expect(createRes.ok()).toBeTruthy();
    const dataset = await createRes.json();
    const datasetId = dataset.id;

    const itemRes = await request.post(`/api/datasets/${datasetId}/items`, {
      data: { input: { original: 'value' }, groundTruth: { expected: 'result' }, expectedTrajectory: {} },
    });
    expect(itemRes.ok()).toBeTruthy();

    await page.goto(`/datasets/${datasetId}`);
    await expectDatasetLoaded(page, 'Edit Item Dataset');

    // Click item button to open detail panel
    await page.getByRole('button', { name: /original/ }).click();

    // Detail panel should show read-only content
    await expect(page.getByRole('heading', { name: /^Item #/, level: 3 })).toBeVisible({ timeout: 5_000 });

    // Open item actions menu → Edit
    await page.getByRole('button', { name: 'Actions menu' }).last().click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();

    // Should switch to edit mode
    await expect(page.getByRole('heading', { name: 'Edit Item', level: 3 })).toBeVisible();

    // Modify the input JSON — use the text content to find the right editor
    const inputEditor = page.getByText('"original": "value"');
    await inputEditor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('{"modified": "updated-value"}');

    // Save changes
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Should return to read-only mode with updated content
    await expect(page.getByRole('heading', { name: 'Edit Item', level: 3 })).not.toBeVisible({ timeout: 10_000 });
    // The updated value appears in both the item list and the detail panel code editor
    await expect(page.getByText('updated-value').first()).toBeVisible({ timeout: 5_000 });

    // Clean up
    await request.delete(`/api/datasets/${datasetId}`);
  });

  test('delete item from detail panel', async ({ page, request }) => {
    // Create dataset + item via API
    const createRes = await request.post('/api/datasets', {
      data: { name: 'Delete Item Dataset', description: 'For item deletion' },
    });
    expect(createRes.ok()).toBeTruthy();
    const dataset = await createRes.json();
    const datasetId = dataset.id;

    const itemRes = await request.post(`/api/datasets/${datasetId}/items`, {
      data: { input: { to_delete: 'this-item' }, groundTruth: { answer: '42' } },
    });
    expect(itemRes.ok()).toBeTruthy();

    await page.goto(`/datasets/${datasetId}`);
    await expect(page.getByText('to_delete')).toBeVisible({ timeout: 10_000 });

    // Click item button to open detail panel
    await page.getByRole('button', { name: /to_delete/ }).click();
    await expect(page.getByRole('heading', { name: /^Item #/, level: 3 })).toBeVisible({ timeout: 5_000 });

    // Open item actions menu → Delete Item
    await page.getByRole('button', { name: 'Actions menu' }).last().click();
    await page.getByRole('menuitem', { name: 'Delete Item' }).click();

    // Confirm in alert dialog
    const alertDialog = page.getByRole('alertdialog');
    await expect(alertDialog).toBeVisible();
    await expect(alertDialog.getByText('delete this item')).toBeVisible();
    await alertDialog.getByRole('button', { name: 'Yes, Delete' }).click();

    // Alert dialog and detail panel should close, item should be gone from list
    await expect(alertDialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('to_delete')).not.toBeVisible({ timeout: 10_000 });

    // The items-only detail page should show its empty state after deletion.
    await expect(page.getByRole('heading', { name: 'No items yet', level: 3 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Single Item' })).toBeVisible();

    // Clean up
    await request.delete(`/api/datasets/${datasetId}`);
  });

  test('view experiments link opens the filtered global experiments page', async ({ page, request }) => {
    // Create dataset via API
    const createRes = await request.post('/api/datasets', {
      data: { name: 'Experiments Link Dataset', description: 'For experiments navigation test' },
    });
    expect(createRes.ok()).toBeTruthy();
    const dataset = await createRes.json();
    const datasetId = dataset.id;

    await page.goto(`/datasets/${datasetId}`);
    await expectDatasetLoaded(page, 'Experiments Link Dataset');

    await page.getByRole('link', { name: 'View experiments' }).click();

    await expect(page).toHaveURL(new RegExp(`/experiments\\?dataset=${datasetId}$`));
    await expect(page.getByRole('heading', { name: 'Experiments', level: 1 })).toBeVisible();

    // Clean up
    await request.delete(`/api/datasets/${datasetId}`);
  });

  test('delete dataset removes it from list', async ({ page, request }) => {
    // Create dataset via API with a unique name
    const uniqueName = `Delete-${Date.now()}`;
    const createRes = await request.post('/api/datasets', {
      data: { name: uniqueName, description: 'Will be deleted' },
    });
    expect(createRes.ok()).toBeTruthy();
    const dataset = await createRes.json();
    const datasetId = dataset.id;

    // Navigate to dataset detail
    await page.goto(`/datasets/${datasetId}`);
    await expectDatasetLoaded(page, uniqueName);

    // Open actions menu and click Delete
    await page.getByRole('button', { name: 'Dataset actions menu' }).first().click();
    await page.getByRole('menuitem', { name: 'Delete Dataset' }).click();

    // Confirm deletion in alert dialog
    const alertDialog = page.getByRole('alertdialog');
    await expect(alertDialog).toBeVisible();
    await expect(alertDialog.getByText(uniqueName)).toBeVisible();
    await alertDialog.getByRole('button', { name: 'Delete' }).click();

    // Should navigate back to datasets list
    await expect(page).toHaveURL(/\/datasets/, { timeout: 10_000 });

    // The specific dataset link should be removed from the DOM entirely
    const datasetLink = page.locator(`a[href="/datasets/${datasetId}"]`);
    await expect(datasetLink).toHaveCount(0, { timeout: 10_000 });
  });

  test('JSON import: upload file and import items', async ({ page, request }) => {
    // Create dataset via API
    const createRes = await request.post('/api/datasets', {
      data: { name: 'JSON Import Dataset', description: 'For JSON import test' },
    });
    expect(createRes.ok()).toBeTruthy();
    const dataset = await createRes.json();
    const datasetId = dataset.id;

    await page.goto(`/datasets/${datasetId}`);
    await expectDatasetLoaded(page, 'JSON Import Dataset');

    // On an empty dataset, Import JSON is a direct button in the empty state
    await page.getByRole('button', { name: 'Import JSON' }).click();

    // The dialog title changes per step, so use a stable locator
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Import JSON' })).toBeVisible();
    await expect(dialog.getByText('JSON files only')).toBeVisible();

    // Upload a JSON file via the hidden file input
    const jsonContent = JSON.stringify([
      { input: 'What is 1+1?', groundTruth: '2' },
      { input: 'What is 2+2?', groundTruth: '4' },
      { input: 'What is 3+3?', groundTruth: '6' },
    ]);
    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-data.json',
      mimeType: 'application/json',
      buffer: Buffer.from(jsonContent),
    });

    // Should advance to preview step showing "Found 3 valid items to import."
    await expect(dialog.getByRole('heading', { name: 'Preview Data' })).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Found 3 valid items to import.')).toBeVisible();
    // Preview table should show our data
    await expect(dialog.getByText('What is 1+1?')).toBeVisible();

    // Click "Import 3 Items"
    await dialog.getByRole('button', { name: /Import 3 Items/ }).click();

    // Should show Import Complete
    await expect(dialog.getByRole('heading', { name: 'Import Complete' })).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('3 items imported')).toBeVisible();

    // Click Done
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).not.toBeVisible();

    // Verify items appear in the dataset list (the items tab should show our data)
    await expect(page.getByText('What is 1+1?')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('What is 2+2?')).toBeVisible();
    await expect(page.getByText('What is 3+3?')).toBeVisible();

    // Clean up
    await request.delete(`/api/datasets/${datasetId}`);
  });

  test('CSV import: upload file and reach mapping step', async ({ page, request }) => {
    // Create dataset via API
    const createRes = await request.post('/api/datasets', {
      data: { name: 'CSV Import Dataset', description: 'For CSV import test' },
    });
    expect(createRes.ok()).toBeTruthy();
    const dataset = await createRes.json();
    const datasetId = dataset.id;

    await page.goto(`/datasets/${datasetId}`);
    await expectDatasetLoaded(page, 'CSV Import Dataset');

    // On an empty dataset, Import CSV is a direct button in the empty state
    await page.getByRole('button', { name: 'Import CSV' }).click();

    // The dialog title changes per step, so use a stable locator
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Import CSV' })).toBeVisible();
    await expect(dialog.getByText('CSV files only')).toBeVisible();

    // Upload a CSV file via the hidden file input
    const csvContent = 'question,answer\nWhat is 1+1?,2\nWhat is 2+2?,4';
    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-data.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent),
    });

    // Should advance to preview step showing the data
    await expect(dialog.getByRole('heading', { name: 'Preview Data' })).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('question')).toBeVisible();
    await expect(dialog.getByText('answer')).toBeVisible();
    await expect(dialog.getByText('What is 1+1?')).toBeVisible();

    // Click Next to go to column mapping
    await dialog.getByRole('button', { name: 'Next' }).click();

    // Should show the Map Columns step with drag zones
    await expect(dialog.getByRole('heading', { name: 'Map Columns' })).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Data passed to target')).toBeVisible();
    await expect(dialog.getByText('Ground truth for comparison')).toBeVisible();
    await expect(dialog.getByText('Not imported')).toBeVisible();

    // Both columns should start in the Ignore zone
    await expect(dialog.getByText('Drag at least one column here')).toBeVisible();

    // Clean up
    await request.delete(`/api/datasets/${datasetId}`);
  });

  test('trigger experiment with scorer and view results', async ({ page, request }) => {
    // Create dataset via API
    const datasetName = `Experiment Dataset ${Date.now()}`;
    const createRes = await request.post('/api/datasets', {
      data: { name: datasetName, description: 'For experiment test' },
    });
    expect(createRes.ok()).toBeTruthy();
    const dataset = await createRes.json();
    const datasetId = dataset.id;

    // Add items with input/output structure for completeness scorer
    const itemPayloads = [
      { input: { input: 'What is AI?', output: 'Artificial intelligence is the simulation of human intelligence.' } },
      { input: { input: 'What is ML?', output: 'Machine learning is a subset of AI.' } },
    ];
    const itemIds: string[] = [];
    for (const item of itemPayloads) {
      const addRes = await request.post(`/api/datasets/${datasetId}/items`, { data: item });
      expect(addRes.ok()).toBeTruthy();
      const addedItem = await addRes.json();
      itemIds.push(addedItem.id);
    }

    // Navigate to dataset page
    await page.goto(`/datasets/${datasetId}`);
    await expectDatasetLoaded(page, datasetName);

    // Click "Run Experiment"
    await page.getByRole('button', { name: /Run Experiment/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Run Experiment' })).toBeVisible();

    // Dataset and version selectors precede Target Type in the redesigned dialog.
    await dialog.getByRole('combobox').nth(2).click();
    await page.getByRole('option', { name: 'Scorer' }).click();

    // Selecting a target type inserts the Target selector before optional scorers.
    await dialog.getByRole('combobox').nth(3).click();
    await page.getByRole('option', { name: 'Completeness Scorer', exact: true }).first().click();

    // Click Run
    await dialog.getByRole('button', { name: 'Run' }).click();

    // Experiment details now live at the top-level /experiments route.
    await page.waitForURL(/\/experiments\/[^/]+$/, { timeout: 15_000 });

    // Verify the persisted experiment summary and its seeded item count.
    await expect(page.getByRole('link', { name: new RegExp(datasetName) })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('main')).toContainText(/Items\s*2 items/);

    // Verify the target is shown as Completeness Scorer.
    await expect(page.getByRole('link', { name: 'Completeness Scorer' })).toBeVisible();

    // Switch to Results tab and verify concrete result rows from our seeded items
    await page.getByRole('tab', { name: 'Results' }).click();
    // Each result row renders the first 8 chars of the dataset item ID
    for (const itemId of itemIds) {
      await expect(page.getByText(itemId.slice(0, 8))).toBeVisible({ timeout: 10_000 });
    }
    // The input text from our seeded items should be visible in the result rows
    await expect(page.getByText('What is AI?')).toBeVisible();
    await expect(page.getByText('What is ML?')).toBeVisible();

    // Clean up
    await request.delete(`/api/datasets/${datasetId}`);
  });
});
