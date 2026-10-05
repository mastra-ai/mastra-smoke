import { test, expect, type Page } from '@playwright/test';

test.describe('Workspaces', () => {
  // Seed fixture files via the workspace filesystem API before tests
  test.beforeAll(async ({ request }) => {
    const base = '/api/workspaces/test-workspace/fs';

    // Create a subdirectory
    await request.post(`${base}/mkdir`, {
      data: { path: 'smoke-fixtures', recursive: true },
    });

    // Write test files
    await request.post(`${base}/write`, {
      data: { path: 'smoke-fixtures/hello.txt', content: 'Hello from smoke test' },
    });
    await request.post(`${base}/write`, {
      data: {
        path: 'smoke-fixtures/config.json',
        content: JSON.stringify({ name: 'smoke', version: '1.0' }, null, 2),
      },
    });
    await request.post(`${base}/write`, {
      data: { path: 'smoke-fixtures/nested/deep.md', content: '# Deep file\n\nNested content here.', recursive: true },
    });
  });

  // Clean up fixture files after all tests. Also wipe .agents/ in case the
  // skill-install test failed mid-flight and left .agents/skills/find-skills
  // on disk — otherwise the next CI run would see "Already Installed" and
  // the install button would be permanently disabled.
  test.afterAll(async ({ request }) => {
    await request.delete(
      `/api/workspaces/test-workspace/fs/delete?path=smoke-fixtures&recursive=true&force=true`,
    );
    await request.delete(
      `/api/workspaces/test-workspace/fs/delete?path=.agents&recursive=true&force=true`,
    );
  });

  // Files and skills share one tree (role=tree). Directories are treeitems whose
  // toggle is a button named after the folder; files are clickable treeitems
  // whose accessible name starts with the file name (followed by size + "Delete …").
  function folder(page: Page, name: string) {
    return page.getByRole('tree').getByRole('button', { name, exact: true });
  }
  function file(page: Page, name: string) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return page.getByRole('treeitem', { name: new RegExp(`^${escaped} `) });
  }
  // "Files · N Skills" summary above the tree.
  function summary(page: Page) {
    return page.getByRole('main').getByText(/^Files.*Skills?$/);
  }

  test('workspace page shows file tree with workspace name', async ({ page }) => {
    await page.goto('/workspaces');
    await expect(page.getByRole('heading', { name: 'Workspaces', level: 1 })).toBeVisible();
    await expect(page.getByText('Test Workspace')).toBeVisible();

    // Single tree view replaced the Files/Skills tabs; no skills installed yet.
    await expect(summary(page)).toHaveText(/0 Skills/);
    await expect(page.getByRole('button', { name: 'New folder', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add skill', exact: true })).toBeVisible();

    // Our fixture directory should appear in the tree, with its folder actions.
    await expect(folder(page, 'smoke-fixtures')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete smoke-fixtures' })).toBeVisible();
  });

  test('file tree: expand directories and view files', async ({ page }) => {
    await page.goto('/workspaces');

    await folder(page, 'smoke-fixtures').click();
    await expect(folder(page, 'smoke-fixtures')).toHaveAttribute('aria-expanded', 'true');
    await expect(file(page, 'hello.txt')).toBeVisible();
    await expect(file(page, 'config.json')).toBeVisible();
    await expect(folder(page, 'nested')).toBeVisible();

    // Selecting a file shows its path and content in the viewer pane.
    await file(page, 'hello.txt').click();
    await expect(file(page, 'hello.txt')).toHaveAttribute('aria-selected', 'true');
    const viewer = page.getByRole('main').getByRole('figure');
    await expect(page.getByRole('main').getByText('smoke-fixtures/hello.txt', { exact: true })).toBeVisible();
    await expect(viewer).toContainText('Hello from smoke test');
    await expect(viewer.getByRole('button', { name: 'Copy to clipboard' })).toBeVisible();

    // Opening another file replaces the viewer content.
    await folder(page, 'nested').click();
    await expect(file(page, 'deep.md')).toBeVisible();
    await file(page, 'deep.md').click();
    await expect(page.getByText('Nested content here.')).toBeVisible();
    await expect(page.getByText('Hello from smoke test')).toHaveCount(0);
  });

  test('file tree: create and delete directory', async ({ page }) => {
    await page.goto('/workspaces');

    // "New folder" is an in-app dialog now (previously a native prompt).
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const newFolder = page.getByRole('dialog', { name: 'New folder' });
    await expect(newFolder.getByRole('button', { name: 'Create' })).toBeDisabled();
    await newFolder.getByRole('textbox', { name: 'Folder path' }).fill('e2e-temp-dir');
    await newFolder.getByRole('button', { name: 'Create' }).click();
    await expect(newFolder).not.toBeVisible();

    await expect(folder(page, 'e2e-temp-dir')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Delete e2e-temp-dir' }).click();
    const alertDialog = page.getByRole('alertdialog', { name: 'Delete folder?' });
    await expect(alertDialog).toContainText('"e2e-temp-dir"');
    await alertDialog.getByRole('button', { name: 'Delete' }).click();

    await expect(folder(page, 'e2e-temp-dir')).toHaveCount(0, { timeout: 5_000 });
    await expect(folder(page, 'smoke-fixtures')).toBeVisible();
  });

  test('add skill dialog lists registry skills', async ({ page }) => {
    await page.route('**/api/workspaces/*/skills-sh/popular*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          skills: [{ id: 'fixture-1', name: 'find-skills', installs: 100, topSource: 'vercel-labs/skills' }],
          count: 1,
          limit: 10,
          offset: 0,
        }),
      }),
    );
    await page.goto('/workspaces');
    await page.getByRole('button', { name: 'Add skill', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Add Skill' });
    await expect(dialog.getByRole('searchbox', { name: 'Search skills' })).toBeVisible();
    await expect(dialog.getByText('Popular Skills')).toBeVisible();
    const skill = dialog.getByRole('button', { name: /^find-skills vercel-labs\/skills/ });
    await expect(skill).toBeVisible();
    // Install appears only once a skill is selected for preview.
    await expect(dialog.getByRole('button', { name: 'Install' })).toHaveCount(0);
    await skill.click();
    await expect(dialog.getByRole('heading', { name: 'find-skills', level: 3 })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Install' })).toBeVisible();
  });

  test('skills tab: install skill from registry and remove it', async ({ page, request }) => {
    // Increase timeout — network calls to skills.sh can be slow
    test.setTimeout(60_000);

    // Pre-clean .agents/ in case a previous run crashed mid-install and left
    // `.agents/skills/find-skills` on disk. If the skill is already installed,
    // Studio renders the install button as disabled with "Already Installed",
    // which makes the click below time out.
    await request.delete(
      `/api/workspaces/test-workspace/fs/delete?path=.agents&recursive=true&force=true`,
    );

    // ── Mock the registry discovery endpoints so the test doesn't depend on
    //    what is trending on skills.sh. The install & remove endpoints still
    //    hit the real server (and the real skills.sh files API) so we validate
    //    the actual install/remove flow end-to-end.
    const SKILL_NAME = 'find-skills';
    const SKILL_OWNER = 'vercel-labs';
    const SKILL_REPO = 'skills';
    const SKILL_SOURCE = `${SKILL_OWNER}/${SKILL_REPO}`;

    const popularPayload = {
      skills: [
        { id: 'fixture-1', name: SKILL_NAME, installs: 100, topSource: SKILL_SOURCE },
      ],
      count: 1,
      limit: 10,
      offset: 0,
    };

    const previewPayload = {
      content: `# ${SKILL_NAME}\n\nA test skill fixture for the smoke suite.`,
    };

    await page.route('**/api/workspaces/*/skills-sh/popular*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(popularPayload) }),
    );
    await page.route('**/api/workspaces/*/skills-sh/preview*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(previewPayload) }),
    );

    await page.goto('/workspaces');
    await expect(summary(page)).toHaveText(/0 Skills/);

    await page.getByRole('button', { name: 'Add skill', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Skill' });

    const skillButton = dialog.getByRole('button', { name: new RegExp(`^${SKILL_NAME} `) });
    await expect(skillButton).toBeVisible({ timeout: 5_000 });
    await skillButton.click();

    // Preview panel should show the skill name and our mocked content
    await expect(dialog.getByRole('heading', { name: SKILL_NAME, level: 3 })).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('A test skill fixture for the smoke suite.')).toBeVisible();

    // Install hits the real server + skills.sh files API
    await dialog.getByTestId('install-skill-button').click();
    await expect(page.getByText(/installed successfully/i)).toBeVisible({ timeout: 20_000 });
    await expect(dialog).not.toBeVisible();

    // Installed skills show up in the tree under .agents/skills/<name> and in the count.
    await expect(summary(page)).toHaveText(/1 Skill\b/);
    await folder(page, '.agents').click();
    await folder(page, 'skills').click();
    await folder(page, SKILL_NAME).click();
    await expect(file(page, 'SKILL.md')).toBeVisible();
    await file(page, 'SKILL.md').click();
    await expect(page.getByRole('main').getByText(`.agents/skills/${SKILL_NAME}/SKILL.md`, { exact: true })).toBeVisible();

    // The skills table (with "Remove <skill>") is gone; removing a skill means
    // deleting its folder from the tree.
    await page.getByRole('button', { name: `Delete ${SKILL_NAME}`, exact: true }).click();
    const alertDialog = page.getByRole('alertdialog', { name: 'Delete folder?' });
    await expect(alertDialog).toContainText(SKILL_NAME);
    await alertDialog.getByRole('button', { name: 'Delete' }).click();

    await expect(folder(page, SKILL_NAME)).toHaveCount(0, { timeout: 5_000 });
    await expect(summary(page)).toHaveText(/0 Skills/);

    // Clean up .agents directory from workspace filesystem (in case of leftover)
    await request.delete(
      `/api/workspaces/test-workspace/fs/delete?path=.agents&recursive=true&force=true`,
    );
  });
});
