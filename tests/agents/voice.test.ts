import { describe, expect, it } from 'vitest';
import { fetchApi, fetchJson } from '../utils.js';

// The smoke fixture agents do not configure a voice provider, so the voice
// endpoints should report no listener and empty speaker lists. This catches
// regressions where the voice surface either crashes or starts returning
// non-empty data for an agent without a provider.

const AGENT_ID = 'test-agent';

describe('agents — voice + speakers (empty-provider shape)', () => {
  it('GET /api/agents/:id/speakers returns [] when no voice provider is configured', async () => {
    const { status, data } = await fetchJson<unknown[]>(
      `/api/agents/${AGENT_ID}/speakers`,
    );
    expect(status).toBe(200);
    expect(data).toEqual([]);
  });

  it('GET /api/agents/:id/voice/speakers returns [] when no voice provider is configured', async () => {
    const { status, data } = await fetchJson<unknown[]>(
      `/api/agents/${AGENT_ID}/voice/speakers`,
    );
    expect(status).toBe(200);
    expect(data).toEqual([]);
  });

  it('GET /api/agents/:id/voice/listener reports listener disabled', async () => {
    const { status, data } = await fetchJson<{ enabled: boolean }>(
      `/api/agents/${AGENT_ID}/voice/listener`,
    );
    expect(status).toBe(200);
    expect(data).toEqual({ enabled: false });
  });

  it('POST /api/agents/:id/voice/listen rejects a body without audio with 400', async () => {
    const res = await fetchApi(`/api/agents/${AGENT_ID}/voice/listen`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as {
      error: string;
      issues?: Array<{ field: string; message: string }>;
    };
    // The route's body schema declares `audio: z.unknown()`. Under zod v4 that key
    // is required, so the server rejects at the validation layer with the
    // structured envelope; under zod v3 the key is optional and the handler's own
    // guard fires instead. Both legs must reject the request as missing audio.
    if (data.error === 'Invalid request body') {
      expect(data.issues?.map((i) => i.field)).toContain('audio');
    } else {
      expect(data.error).toBe('Audio data is required');
    }
  });

  it('GET /api/agents/:id/speakers returns 404 for an unknown agent', async () => {
    const res = await fetchApi('/api/agents/smoke-no-such-agent/speakers');
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/smoke-no-such-agent/);
  });
});
