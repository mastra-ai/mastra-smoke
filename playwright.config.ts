import { defineConfig, devices } from '@playwright/test';
import getPort from 'get-port';

// Workers inherit the parent's selected port instead of choosing another one.
const PORT = process.env.STUDIO_PORT || String(await getPort({ host: '127.0.0.1' }));
process.env.STUDIO_PORT = PORT;
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

  // Own a fresh server and private storage on every invocation; never reuse a
  // process found on the port or delete files beneath a running server.
  globalSetup: './tests-ui/server.ts',
});
