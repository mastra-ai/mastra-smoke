import { describe, expect, it } from 'vitest';
import { fetchApi, fetchJson } from '../utils.js';

// Use a feedbackType/scorerId distinct from anything other tests touch so
// that aggregations.test.ts can keep asserting empty results for its own
// nonce ids regardless of which file runs first.
const FEEDBACK_TYPE = `smoke-feedback-${Date.now()}`;
const SCORER_ID = `smoke-scorer-${Date.now()}`;
const ENTITY_ID = `smoke-entity-${Date.now()}`;
// Feedback and score POSTs require a nonblank traceId (mastra-ai/mastra#29287).
const TRACE_ID = `smoke-trace-${Date.now()}`;

describe('observability — feedback ingest + read', () => {
  it('POST /api/observability/feedback rejects a missing feedback object with a structured 400', async () => {
    const res = await fetchApi('/api/observability/feedback', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as {
      error: string;
      issues: Array<{ field: string; message: string }>;
    };
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid request body');
    expect(data.issues.map((i) => i.field)).toContain('feedback');
  });

  it.each([
    ['missing', undefined, 'expected string'],
    ['whitespace-only', '   ', 'must not be empty or whitespace-only'],
  ])('POST /api/observability/feedback rejects a %s traceId with a structured 400', async (_label, traceId, message) => {
    const res = await fetchApi('/api/observability/feedback', {
      method: 'POST',
      body: JSON.stringify({ feedback: { traceId, feedbackType: FEEDBACK_TYPE, value: 1 } }),
    });
    const data = (await res.json()) as { error: string; issues: Array<{ field: string; message: string }> };
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid request body');
    const issue = data.issues.find((i) => i.field === 'feedback.traceId');
    expect(issue, JSON.stringify(data.issues)).toBeDefined();
    expect(issue!.message).toContain(message);
  });

  it('POST /api/observability/feedback persists a feedback row that shows up in GET /api/observability/feedback', async () => {
    const ingest = await fetchJson<{ success: boolean }>('/api/observability/feedback', {
      method: 'POST',
      body: JSON.stringify({
        feedback: {
          traceId: TRACE_ID,
          spanId: 'smoke-span-1',
          feedbackType: FEEDBACK_TYPE,
          entityType: 'agent',
          entityId: ENTITY_ID,
          value: 1,
        },
      }),
    });
    expect(ingest.status).toBe(200);
    expect(ingest.data.success).toBe(true);

    // Newest-first list — find our row by feedbackType.
    const { status, data } = await fetchJson<{
      pagination: { total: number; page: number; perPage: number; hasMore: boolean };
      feedback: Array<{
        feedbackId: string;
        feedbackType: string;
        traceId: string;
        spanId: string | null;
        entityType: string;
        entityId: string;
        value: unknown;
      }>;
    }>('/api/observability/feedback?perPage=100');

    expect(status).toBe(200);
    expect(data.pagination).toMatchObject({
      total: expect.any(Number),
      page: expect.any(Number),
      perPage: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    expect(data.pagination.total).toBeGreaterThan(0);

    const row = data.feedback.find((f) => f.feedbackType === FEEDBACK_TYPE);
    expect(row, `feedbackType=${FEEDBACK_TYPE} not found in list`).toBeDefined();
    expect(row!.traceId).toBe(TRACE_ID);
    expect(row!.spanId).toBe('smoke-span-1');
    expect(row!.entityType).toBe('agent');
    expect(row!.entityId).toBe(ENTITY_ID);
    expect(row!.value).toBe(1);
    expect(row!.feedbackId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe('observability — scores ingest + read', () => {
  it('POST /api/observability/scores rejects a missing score object with a structured 400', async () => {
    const res = await fetchApi('/api/observability/scores', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as {
      error: string;
      issues: Array<{ field: string; message: string }>;
    };
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid request body');
    expect(data.issues.map((i) => i.field)).toContain('score');
  });

  it('POST /api/observability/scores rejects a score without a traceId with a structured 400', async () => {
    const res = await fetchApi('/api/observability/scores', {
      method: 'POST',
      body: JSON.stringify({ score: { scorerId: SCORER_ID, entityType: 'agent', entityId: ENTITY_ID, score: 0.5 } }),
    });
    const data = (await res.json()) as { error: string; issues: Array<{ field: string; message: string }> };
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid request body');
    expect(data.issues.map((i) => i.field)).toContain('score.traceId');
  });

  it('POST /api/observability/scores persists a score row that shows up in GET /api/observability/scores', async () => {
    const ingest = await fetchJson<{ success: boolean }>('/api/observability/scores', {
      method: 'POST',
      body: JSON.stringify({
        score: {
          traceId: TRACE_ID,
          scorerId: SCORER_ID,
          entityType: 'agent',
          entityId: ENTITY_ID,
          score: 0.5,
        },
      }),
    });
    expect(ingest.status).toBe(200);
    expect(ingest.data.success).toBe(true);

    const { status, data } = await fetchJson<{
      pagination: { total: number };
      scores: Array<{
        scoreId: string;
        traceId: string;
        spanId: string | null;
        entityType: string;
        entityId: string;
        score: number;
      }>;
    }>('/api/observability/scores?perPage=100');

    expect(status).toBe(200);
    expect(data.pagination.total).toBeGreaterThan(0);

    const row = data.scores.find((s) => s.entityId === ENTITY_ID);
    expect(row, `entityId=${ENTITY_ID} not found in scores list`).toBeDefined();
    expect(row!.traceId).toBe(TRACE_ID);
    expect(row!.spanId).toBe(null);
    expect(row!.entityType).toBe('agent');
    expect(row!.score).toBe(0.5);
    expect(row!.scoreId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('GET /api/observability/scores/:id returns { score: null } for an unknown id', async () => {
    const { status, data } = await fetchJson<{ score: unknown }>(
      '/api/observability/scores/does-not-exist-smoke',
    );
    expect(status).toBe(200);
    expect(data.score).toBe(null);
  });
});

describe('observability — traces/score', () => {
  it('POST /api/observability/traces/score rejects a missing scorerName with a structured 400', async () => {
    const res = await fetchApi('/api/observability/traces/score', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as {
      error: string;
      issues: Array<{ field: string; message: string }>;
    };
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid request body');
    const fields = data.issues.map((i) => i.field);
    expect(fields).toContain('scorerName');
    expect(fields).toContain('targets');
  });

  it('POST /api/observability/traces/score errors when the scorer is not registered', async () => {
    const res = await fetchApi('/api/observability/traces/score', {
      method: 'POST',
      body: JSON.stringify({
        scorerName: 'smoke-unregistered-scorer',
        targets: [{ traceId: 'smoke-trace-1' }],
      }),
    });
    const data = (await res.json()) as { error: string };
    // Upstream currently returns 500 for unknown scorer; assert the message
    // names the scorer so a regression that swallows the id is caught.
    expect(res.status).toBe(500);
    expect(data.error).toMatch(/smoke-unregistered-scorer/);
  });
});
