import { afterAll, describe, expect, it } from 'vitest';
import { fetchApi, fetchJson } from '../utils.js';

// Mastra ships an OpenAI Responses-compatible surface under /api/v1/* so that
// SDKs targeting the OpenAI Responses API can talk to a Mastra agent. The shape
// is a public contract — break it and downstream third-party clients break.
//
// This suite covers the full CRUD pair (conversations + responses) plus the
// negative-path 404s. Happy paths use `test-agent` (gpt-4o-mini) and are
// LLM-bound, so this file is tagged @llm via the test names.

const createdConversationIds = new Set<string>();
const createdResponseIds = new Set<string>();

afterAll(async () => {
  // Best-effort cleanup so re-running the suite leaves no leaked state.
  for (const id of createdResponseIds) {
    await fetchApi(`/api/v1/responses/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdConversationIds) {
    await fetchApi(`/api/v1/conversations/${id}`, { method: 'DELETE' }).catch(() => {});
  }
});

describe('/api/v1 OpenAI Responses-compatible surface', () => {
  describe('conversations', () => {
    it('POST /v1/conversations requires agent_id', async () => {
      const { status, data } = await fetchJson<any>('/api/v1/conversations', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(status).toBe(400);
      expect(typeof data.error).toBe('string');
    });

    it('POST /v1/conversations creates a conversation with OpenAI-shaped response', async () => {
      const { status, data } = await fetchJson<any>('/api/v1/conversations', {
        method: 'POST',
        body: JSON.stringify({ agent_id: 'test-agent' }),
      });
      expect(status).toBe(200);
      expect(typeof data.id).toBe('string');
      expect(data.object).toBe('conversation');
      expect(data.thread).toBeDefined();
      expect(data.thread.id).toBe(data.id);
      createdConversationIds.add(data.id);
    });

    it('GET /v1/conversations/:id round-trips the conversation', async () => {
      const created = await fetchJson<any>('/api/v1/conversations', {
        method: 'POST',
        body: JSON.stringify({ agent_id: 'test-agent' }),
      });
      const id = created.data.id;
      createdConversationIds.add(id);

      const { status, data } = await fetchJson<any>(`/api/v1/conversations/${id}`);
      expect(status).toBe(200);
      expect(data.id).toBe(id);
      expect(data.object).toBe('conversation');
      expect(data.thread.id).toBe(id);
    });

    it('GET /v1/conversations/:id/items returns an OpenAI-shaped list for an empty conversation', async () => {
      const created = await fetchJson<any>('/api/v1/conversations', {
        method: 'POST',
        body: JSON.stringify({ agent_id: 'test-agent' }),
      });
      const id = created.data.id;
      createdConversationIds.add(id);

      const { status, data } = await fetchJson<any>(`/api/v1/conversations/${id}/items`);
      expect(status).toBe(200);
      expect(data.object).toBe('list');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(0);
      expect(data.has_more).toBe(false);
    });

    it('GET /v1/conversations/:id returns 404 for an unknown conversation', async () => {
      const { status, data } = await fetchJson<any>('/api/v1/conversations/does-not-exist-smoke');
      expect(status).toBe(404);
      expect(typeof data.error).toBe('string');
    });

    it('DELETE /v1/conversations/:id removes the conversation and returns deleted=true', async () => {
      const created = await fetchJson<any>('/api/v1/conversations', {
        method: 'POST',
        body: JSON.stringify({ agent_id: 'test-agent' }),
      });
      const id = created.data.id;

      const del = await fetchJson<any>(`/api/v1/conversations/${id}`, { method: 'DELETE' });
      expect(del.status).toBe(200);
      expect(del.data.id).toBe(id);
      expect(del.data.object).toBe('conversation.deleted');
      expect(del.data.deleted).toBe(true);

      const after = await fetchJson<any>(`/api/v1/conversations/${id}`);
      expect(after.status).toBe(404);
    });
  });

  describe('responses', () => {
    it('POST /v1/responses requires input', async () => {
      const { status, data } = await fetchJson<any>('/api/v1/responses', {
        method: 'POST',
        body: JSON.stringify({ agent_id: 'test-agent' }),
      });
      expect(status).toBe(400);
      expect(typeof data.error).toBe('string');
    });

    it('POST /v1/responses with input + agent_id returns an OpenAI Responses-shaped object @llm', async () => {
      const { status, data } = await fetchJson<any>('/api/v1/responses', {
        method: 'POST',
        body: JSON.stringify({
          input: 'Say "hello" and nothing else.',
          agent_id: 'test-agent',
        }),
      });
      expect(status).toBe(200);
      expect(typeof data.id).toBe('string');
      expect(data.object).toBe('response');
      expect(data.status).toBe('completed');
      expect(typeof data.model).toBe('string');
      expect(Array.isArray(data.output)).toBe(true);
      expect(data.output.length).toBeGreaterThan(0);

      const message = data.output.find((o: any) => o.type === 'message');
      expect(message).toBeDefined();
      expect(message.role).toBe('assistant');
      expect(Array.isArray(message.content)).toBe(true);

      expect(data.usage).toBeDefined();
      expect(typeof data.usage.total_tokens).toBe('number');

      createdResponseIds.add(data.id);
    }, 45_000);

    it('GET /v1/responses/:id returns 404 for an unknown response', async () => {
      const { status, data } = await fetchJson<any>('/api/v1/responses/does-not-exist-smoke');
      expect(status).toBe(404);
      expect(typeof data.error).toBe('string');
    });

    it('DELETE /v1/responses/:id returns 404 for an unknown response', async () => {
      const { status, data } = await fetchJson<any>('/api/v1/responses/does-not-exist-smoke', {
        method: 'DELETE',
      });
      expect(status).toBe(404);
      expect(typeof data.error).toBe('string');
    });
  });
});
