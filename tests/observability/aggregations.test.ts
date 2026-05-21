import { describe, expect, it } from 'vitest';
import { fetchApi, fetchJson } from '../utils.js';

type Issues = { error: string; issues: Array<{ field: string; message: string }> };

// Use a feedbackType nonce that no other test file ingests so this file's
// "empty store" assertions don't get polluted by tests that POST feedback.
const FEEDBACK_TYPE = `smoke-agg-${Date.now()}`;

async function expect400WithField(path: string, body: unknown, field: string) {
  const res = await fetchApi(path, { method: 'POST', body: JSON.stringify(body) });
  const data = (await res.json()) as Issues;
  expect(res.status).toBe(400);
  expect(data.error).toBe('Invalid request body');
  expect(data.issues.map((i) => i.field)).toContain(field);
}

describe('observability — score aggregations', () => {
  it('POST /api/observability/scores/aggregate returns a null value with no scores in store', async () => {
    const { status, data } = await fetchJson<{ value: number | null }>(
      '/api/observability/scores/aggregate',
      {
        method: 'POST',
        body: JSON.stringify({ scorerId: 'smoke-unknown-scorer', aggregation: 'sum', filters: {} }),
      },
    );
    expect(status).toBe(200);
    expect(data.value).toBe(null);
  });

  it('POST /api/observability/scores/aggregate rejects a missing scorerId with structured 400', async () => {
    await expect400WithField('/api/observability/scores/aggregate', {}, 'scorerId');
  });

  it('POST /api/observability/scores/breakdown returns an empty groups array', async () => {
    const { status, data } = await fetchJson<{ groups: unknown[] }>(
      '/api/observability/scores/breakdown',
      {
        method: 'POST',
        body: JSON.stringify({
          scorerId: 'smoke-unknown-scorer',
          groupBy: ['entityType'],
          aggregation: 'sum',
          filters: {},
        }),
      },
    );
    expect(status).toBe(200);
    expect(data.groups).toEqual([]);
  });

  it('POST /api/observability/scores/breakdown rejects a missing groupBy with structured 400', async () => {
    await expect400WithField(
      '/api/observability/scores/breakdown',
      { scorerId: 'smoke-unknown-scorer', aggregation: 'sum', filters: {} },
      'groupBy',
    );
  });

  it('POST /api/observability/scores/percentiles returns one series per requested percentile, each with empty points', async () => {
    const { status, data } = await fetchJson<{
      series: Array<{ percentile: number; points: unknown[] }>;
    }>('/api/observability/scores/percentiles', {
      method: 'POST',
      body: JSON.stringify({
        scorerId: 'smoke-unknown-scorer',
        percentiles: [0.5, 0.95],
        interval: '1m',
        filters: {},
      }),
    });
    expect(status).toBe(200);
    expect(data.series).toHaveLength(2);
    expect(data.series[0]).toMatchObject({ percentile: 0.5, points: [] });
    expect(data.series[1]).toMatchObject({ percentile: 0.95, points: [] });
  });

  it('POST /api/observability/scores/timeseries returns a single series named after the scorerId with empty points', async () => {
    const { status, data } = await fetchJson<{
      series: Array<{ name: string; points: unknown[] }>;
    }>('/api/observability/scores/timeseries', {
      method: 'POST',
      body: JSON.stringify({
        scorerId: 'smoke-unknown-scorer',
        interval: '1m',
        aggregation: 'sum',
        filters: {},
      }),
    });
    expect(status).toBe(200);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('smoke-unknown-scorer');
    expect(data.series[0].points).toEqual([]);
  });
});

describe('observability — feedback aggregations', () => {
  it('POST /api/observability/feedback/aggregate returns value 0 with no feedback in store', async () => {
    const { status, data } = await fetchJson<{ value: number }>(
      '/api/observability/feedback/aggregate',
      {
        method: 'POST',
        body: JSON.stringify({ feedbackType: FEEDBACK_TYPE, aggregation: 'count', filters: {} }),
      },
    );
    expect(status).toBe(200);
    expect(data.value).toBe(0);
  });

  it('POST /api/observability/feedback/aggregate rejects a missing feedbackType with structured 400', async () => {
    await expect400WithField('/api/observability/feedback/aggregate', {}, 'feedbackType');
  });

  it('POST /api/observability/feedback/breakdown returns an empty groups array', async () => {
    const { status, data } = await fetchJson<{ groups: unknown[] }>(
      '/api/observability/feedback/breakdown',
      {
        method: 'POST',
        body: JSON.stringify({
          feedbackType: FEEDBACK_TYPE,
          groupBy: ['entityType'],
          aggregation: 'count',
          filters: {},
        }),
      },
    );
    expect(status).toBe(200);
    expect(data.groups).toEqual([]);
  });

  it('POST /api/observability/feedback/percentiles returns one series per requested percentile, each with empty points', async () => {
    const { status, data } = await fetchJson<{
      series: Array<{ percentile: number; points: unknown[] }>;
    }>('/api/observability/feedback/percentiles', {
      method: 'POST',
      body: JSON.stringify({
        feedbackType: FEEDBACK_TYPE,
        percentiles: [0.5, 0.95],
        interval: '1m',
        filters: {},
      }),
    });
    expect(status).toBe(200);
    expect(data.series).toHaveLength(2);
    expect(data.series[0]).toMatchObject({ percentile: 0.5, points: [] });
    expect(data.series[1]).toMatchObject({ percentile: 0.95, points: [] });
  });

  it('POST /api/observability/feedback/timeseries returns a single series named after the feedbackType with empty points', async () => {
    const { status, data } = await fetchJson<{
      series: Array<{ name: string; points: unknown[] }>;
    }>('/api/observability/feedback/timeseries', {
      method: 'POST',
      body: JSON.stringify({
        feedbackType: FEEDBACK_TYPE,
        interval: '1m',
        aggregation: 'count',
        filters: {},
      }),
    });
    expect(status).toBe(200);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe(FEEDBACK_TYPE);
    expect(data.series[0].points).toEqual([]);
  });
});

describe('observability — metric aggregations', () => {
  it('POST /api/observability/metrics/aggregate returns a null value with no metrics in store', async () => {
    const { status, data } = await fetchJson<{
      value: number | null;
      estimatedCost: number | null;
      costUnit: string | null;
    }>('/api/observability/metrics/aggregate', {
      method: 'POST',
      body: JSON.stringify({ name: ['smoke-unknown'], aggregation: 'sum', filters: {} }),
    });
    expect(status).toBe(200);
    expect(data.value).toBe(null);
    expect(data.estimatedCost).toBe(null);
    expect(data.costUnit).toBe(null);
  });

  it('POST /api/observability/metrics/aggregate rejects a missing name with structured 400', async () => {
    await expect400WithField('/api/observability/metrics/aggregate', {}, 'name');
  });

  it('POST /api/observability/metrics/breakdown returns an empty groups array', async () => {
    const { status, data } = await fetchJson<{ groups: unknown[] }>(
      '/api/observability/metrics/breakdown',
      {
        method: 'POST',
        body: JSON.stringify({
          name: ['smoke-unknown'],
          groupBy: ['entityType'],
          aggregation: 'sum',
          filters: {},
        }),
      },
    );
    expect(status).toBe(200);
    expect(data.groups).toEqual([]);
  });

  it('POST /api/observability/metrics/percentiles returns one series per requested percentile, each with empty points', async () => {
    const { status, data } = await fetchJson<{
      series: Array<{ percentile: number; points: unknown[] }>;
    }>('/api/observability/metrics/percentiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'smoke-unknown',
        percentiles: [0.5, 0.95],
        interval: '1m',
        filters: {},
      }),
    });
    expect(status).toBe(200);
    expect(data.series).toHaveLength(2);
    expect(data.series[0]).toMatchObject({ percentile: 0.5, points: [] });
    expect(data.series[1]).toMatchObject({ percentile: 0.95, points: [] });
  });

  it('POST /api/observability/metrics/timeseries returns one series per name, each with empty points and a costUnit field', async () => {
    const { status, data } = await fetchJson<{
      series: Array<{ name: string; costUnit: string | null; points: unknown[] }>;
    }>('/api/observability/metrics/timeseries', {
      method: 'POST',
      body: JSON.stringify({
        name: ['smoke-unknown'],
        interval: '1m',
        aggregation: 'sum',
        filters: {},
      }),
    });
    expect(status).toBe(200);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('smoke-unknown');
    expect(data.series[0].costUnit).toBe(null);
    expect(data.series[0].points).toEqual([]);
  });
});
