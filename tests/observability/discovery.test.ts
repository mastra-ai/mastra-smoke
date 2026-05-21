import { describe, expect, it } from 'vitest';
import { fetchApi, fetchJson } from '../utils.js';

// These endpoints surface whatever telemetry has accumulated on the running
// fixture. Other test files (agents, workflows) emit traces before this one
// runs, so we assert on:
//   1. Status + the named array key being present.
//   2. Every element is a string (catches a regression that returns objects).
//   3. Where a known-stable value exists (e.g. service-names always contains
//      the fixture's `smoke-test` service), assert it's there. This proves
//      the endpoint is actually querying telemetry, not returning a constant.

describe('observability — discovery endpoints', () => {
  it('GET /api/observability/discovery/environments returns a string[] including `production`', async () => {
    const { status, data } = await fetchJson<{ environments: string[] }>(
      '/api/observability/discovery/environments',
    );
    expect(status).toBe(200);
    expect(Array.isArray(data.environments)).toBe(true);
    for (const env of data.environments) expect(typeof env).toBe('string');
    expect(data.environments).toContain('production');
  });

  it('GET /api/observability/discovery/entity-types returns a string[] including `agent`', async () => {
    const { status, data } = await fetchJson<{ entityTypes: string[] }>(
      '/api/observability/discovery/entity-types',
    );
    expect(status).toBe(200);
    expect(Array.isArray(data.entityTypes)).toBe(true);
    for (const t of data.entityTypes) expect(typeof t).toBe('string');
    expect(data.entityTypes).toContain('agent');
  });

  it('GET /api/observability/discovery/entity-names returns a non-empty string[]', async () => {
    const { status, data } = await fetchJson<{ names: string[] }>(
      '/api/observability/discovery/entity-names',
    );
    expect(status).toBe(200);
    expect(data.names.length).toBeGreaterThan(0);
    for (const n of data.names) expect(typeof n).toBe('string');
  });

  it('GET /api/observability/discovery/metric-names returns a non-empty string[] including a mastra_ prefixed metric', async () => {
    const { status, data } = await fetchJson<{ names: string[] }>(
      '/api/observability/discovery/metric-names',
    );
    expect(status).toBe(200);
    expect(data.names.length).toBeGreaterThan(0);
    for (const n of data.names) expect(typeof n).toBe('string');
    expect(data.names.some((n) => n.startsWith('mastra_'))).toBe(true);
  });

  it('GET /api/observability/discovery/service-names returns a string[] including `smoke-test`', async () => {
    const { status, data } = await fetchJson<{ serviceNames: string[] }>(
      '/api/observability/discovery/service-names',
    );
    expect(status).toBe(200);
    expect(Array.isArray(data.serviceNames)).toBe(true);
    for (const s of data.serviceNames) expect(typeof s).toBe('string');
    expect(data.serviceNames).toContain('smoke-test');
  });

  it('GET /api/observability/discovery/tags returns a tags array of strings', async () => {
    const { status, data } = await fetchJson<{ tags: string[] }>(
      '/api/observability/discovery/tags',
    );
    expect(status).toBe(200);
    expect(Array.isArray(data.tags)).toBe(true);
    for (const t of data.tags) expect(typeof t).toBe('string');
  });

  it('GET /api/observability/discovery/metric-label-keys returns [] for a metricName that does not exist', async () => {
    const { status, data } = await fetchJson<{ keys: unknown[] }>(
      '/api/observability/discovery/metric-label-keys?metricName=smoke-unknown-metric',
    );
    expect(status).toBe(200);
    expect(data.keys).toEqual([]);
  });

  it('GET /api/observability/discovery/metric-label-keys rejects missing metricName with a structured 400', async () => {
    const res = await fetchApi('/api/observability/discovery/metric-label-keys');
    const data = (await res.json()) as {
      error: string;
      issues: Array<{ field: string; message: string }>;
    };
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid query parameters');
    expect(data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'metricName', message: expect.any(String) }),
      ]),
    );
  });

  it('GET /api/observability/discovery/metric-label-values returns [] for an unknown metricName + labelKey', async () => {
    const { status, data } = await fetchJson<{ values: unknown[] }>(
      '/api/observability/discovery/metric-label-values?metricName=smoke-unknown-metric&labelKey=smoke-unknown-label',
    );
    expect(status).toBe(200);
    expect(data.values).toEqual([]);
  });

  it('GET /api/observability/discovery/metric-label-values rejects missing metricName/labelKey with a structured 400', async () => {
    const res = await fetchApi('/api/observability/discovery/metric-label-values');
    const data = (await res.json()) as {
      error: string;
      issues: Array<{ field: string; message: string }>;
    };
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid query parameters');
    expect(data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'metricName', message: expect.any(String) }),
        expect.objectContaining({ field: 'labelKey', message: expect.any(String) }),
      ]),
    );
  });
});
