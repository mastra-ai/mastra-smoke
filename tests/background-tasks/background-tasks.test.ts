import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { fetchApi, fetchJson } from '../utils.js';

// The CI matrix installs zod 3 or zod 4 into the app; the server bundles against whichever resolves.
const zodMajor = Number(createRequire(import.meta.url)('zod/package.json').version.split('.')[0]);

describe('background tasks — list', () => {
  // Known upstream bug on zod 3 (KNOWN_ISSUES.md #13, fix pending in mastra-ai/mastra#24394): the list route mixes
  // bare `zod` with `zod/v4` schemas and rejects every query. Pin the exact failure so this flips red when the fix ships.
  it.runIf(zodMajor === 3)('GET /background-tasks still fails query parsing on zod 3 (mastra-ai/mastra#24394)', async () => {
    const res = await fetchApi('/api/background-tasks');
    expect(res.status).toBe(400);
    const data: any = await res.json();
    expect(data.issues).toEqual([{ field: 'unknown', message: 'keyValidator._parse is not a function' }]);
  });

  it.runIf(zodMajor !== 3)('GET /background-tasks returns the paginated tasks envelope with the seeded task', async () => {
    const { status, data } = await fetchJson<any>('/api/background-tasks');
    expect(status).toBe(200);
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(typeof data.total).toBe('number');
    expect(data.total).toBe(data.tasks.length);

    const seeded = data.tasks.find((t: any) => t.id === 'seed-background-task');
    expect(seeded).toBeDefined();
    expect(seeded.status).toBe('completed');
    expect(seeded.toolName).toBe('calculator');
    expect(seeded.agentId).toBe('test-agent');
    expect(seeded.result).toEqual({ value: 3 });
  });

  it('GET /background-tasks/:id returns the seeded task by id', async () => {
    const { status, data } = await fetchJson<any>('/api/background-tasks/seed-background-task');
    expect(status).toBe(200);
    expect(data.id).toBe('seed-background-task');
    expect(data.status).toBe('completed');
    expect(data.toolName).toBe('calculator');
  });

  it('GET /background-tasks/:id returns a structured 404 for an unknown id', async () => {
    const res = await fetchApi('/api/background-tasks/does-not-exist-smoke');
    expect(res.status).toBe(404);
    const data: any = await res.json();
    expect(data.error).toMatch(/background task not found/i);
  });
});
