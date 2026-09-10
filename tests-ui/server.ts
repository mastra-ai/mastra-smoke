import type { FullConfig } from '@playwright/test';
import { startSmokeServer } from '../scripts/smoke-server.js';

export default async function setup(config: FullConfig) {
  const baseUrl = config.projects[0].use.baseURL;
  if (!baseUrl) throw new Error('Playwright baseURL must be configured');
  const server = await startSmokeServer({ suite: 'ui', port: Number(new URL(baseUrl).port) });
  return () => server.stop();
}
