import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const PORT = process.env.STUDIO_PORT || '4555';
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests-ui',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['list'],
        ['json', { outputFile: 'reports/ui-results.json' }],
        ['junit', { outputFile: 'reports/ui-junit.xml' }],
      ]
    : 'html',
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts$/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    // Cleanup must happen inside the webServer command (before the server
    // boots), not in globalSetup — Playwright starts the webServer before
    // globalSetup, so deleting the DB there unlinks it under the live server.
    command: `node tests-ui/pre-server.mjs && MASTRA_STUDIO_PATH=.mastra/output/studio PORT=${PORT} MASTRA_HOST=127.0.0.1 MASTRA_AUTO_DETECT_URL=true node ${existsSync('.env') ? '--env-file=.env' : ''} .mastra/output/index.mjs`,
    url: `${BASE_URL}/api/workflows`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
