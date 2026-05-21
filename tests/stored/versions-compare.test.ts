import { afterAll, describe, expect, it } from 'vitest';
import { fetchApi, fetchJson } from '../utils.js';

const AGENT_ID = `smoke-cmp-${Date.now()}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

describe('stored agents — versions/compare', () => {
  let v1: string;
  let v2: string;

  afterAll(async () => {
    await fetchApi(`/api/stored/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(
      () => {},
    );
  });

  it('creates v1 then patches to produce v2', async () => {
    const create = await fetchJson<{ activeVersionId: string }>(
      '/api/stored/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          id: AGENT_ID,
          name: 'cmp',
          instructions: 'first',
          model: { provider: 'openai', name: 'gpt-4o-mini' },
        }),
      },
    );
    expect(create.status).toBe(200);
    v1 = create.data.activeVersionId;
    expect(v1).toMatch(UUID_RE);

    const patch = await fetchJson<{ activeVersionId: string }>(
      `/api/stored/agents/${AGENT_ID}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ instructions: 'second' }),
      },
    );
    expect(patch.status).toBe(200);
    v2 = patch.data.activeVersionId;
    expect(v2).toMatch(UUID_RE);
    expect(v2).not.toBe(v1);
  });

  it('GET /api/stored/agents/:id/versions/compare rejects missing from/to with a structured 400', async () => {
    const res = await fetchApi(
      `/api/stored/agents/${AGENT_ID}/versions/compare`,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as {
      error: string;
      issues: Array<{ field: string }>;
    };
    expect(data.error).toBe('Invalid query parameters');
    const fields = data.issues.map((i) => i.field);
    expect(fields).toContain('from');
    expect(fields).toContain('to');
  });

  it('GET /api/stored/agents/:id/versions/compare returns 404 for an unknown version id', async () => {
    const res = await fetchApi(
      `/api/stored/agents/${AGENT_ID}/versions/compare?from=00000000-0000-0000-0000-000000000000&to=${v2}`,
    );
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(
      /Version with id 00000000-0000-0000-0000-000000000000 not found/,
    );
  });

  it('GET /api/stored/agents/:id/versions/compare returns the diff between v1 and v2', async () => {
    const { status, data } = await fetchJson<{
      diffs: Array<{
        field: string;
        previousValue: unknown;
        currentValue: unknown;
      }>;
      fromVersion: { id: string; versionNumber: number; createdAt: string };
      toVersion: { id: string; versionNumber: number; createdAt: string };
    }>(
      `/api/stored/agents/${AGENT_ID}/versions/compare?from=${v1}&to=${v2}`,
    );

    expect(status).toBe(200);
    expect(data.diffs.length).toBeGreaterThan(0);

    const instructionsDiff = data.diffs.find((d) => d.field === 'instructions');
    expect(
      instructionsDiff,
      'expected an instructions diff between v1 and v2',
    ).toMatchObject({
      field: 'instructions',
      previousValue: 'first',
      currentValue: 'second',
    });

    expect(data.fromVersion.id).toBe(v1);
    expect(data.fromVersion.versionNumber).toBe(1);
    expect(data.fromVersion.createdAt).toMatch(ISO_RE);

    expect(data.toVersion.id).toBe(v2);
    expect(data.toVersion.versionNumber).toBe(2);
    expect(data.toVersion.createdAt).toMatch(ISO_RE);
  });
});
