import { test, expect } from '@playwright/test';

test.describe('Logs', () => {
  test('/logs renders header, controls and real log rows from the fixture', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    // Trigger a workflow that throws on purpose, then wait until its asynchronous
    // log write is queryable before loading the logs page.
    await request.post('/api/workflows/failure-workflow/start-async', {
      data: { inputData: { input: 'logs-ui-smoke' } },
    }).catch(() => {});
    await expect
      .poll(
        async () => {
          const response = await request.get('/api/logs?transportId=memory&page=1&perPage=100');
          if (!response.ok()) return false;
          const data = (await response.json()) as { logs: Array<{ msg: string; level: number }> };
          return data.logs.some(({ msg, level }) => level === 50 && msg.includes('Intentional failure for smoke test'));
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    await page.goto('/logs');
    await expect(page).toHaveURL(/\/logs/);
    await expect(page.getByRole('heading', { name: /^logs$/i }).first()).toBeVisible();

    // Filter controls.
    await expect(page.getByRole('button', { name: /last 24 hours/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /add filter/i }).first()).toBeVisible();

    // We should see at least one real log row with concrete content from the fixture
    // (e.g. a workflow error or a "no memory configured" warning from agent runs).
    const logRow = page.getByRole('button', { name: /ERROR|WARN/ }).first();
    await expect(logRow).toBeVisible({ timeout: 20_000 });

    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
