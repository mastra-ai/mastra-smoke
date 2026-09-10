import type { TestProject } from 'vitest/node';
import { startSmokeServer } from '../scripts/smoke-server.js';

export default async function setup(project: TestProject) {
  const server = await startSmokeServer({ suite: 'api' });
  project.provide('baseUrl', server.baseUrl);
  return () => server.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
  }
}
