import { describe, expect, it } from 'vitest';
import { fetchJson } from '../utils.js';

// A2A (Agent-to-Agent) is Mastra's JSON-RPC surface that lets other agents
// discover and message a Mastra-hosted agent. Two surfaces:
//   - GET  /.well-known/:agentId/agent-card.json — discovery
//   - POST /a2a/:agentId                          — JSON-RPC 2.0 message bus
// Both are public contracts that third-party A2A clients depend on.

describe('A2A — agent card discovery', () => {
  it('GET /.well-known/:agentId/agent-card.json returns an A2A agent card', async () => {
    const { status, data } = await fetchJson<{
      name: string;
      description: string;
      url: string;
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      skills: Array<{ id: string; name?: string; description?: string }>;
    }>('/api/.well-known/test-agent/agent-card.json');

    expect(status).toBe(200);
    expect(data.name).toBe('test-agent');
    expect(typeof data.description).toBe('string');
    expect(data.description.length).toBeGreaterThan(0);
    expect(typeof data.url).toBe('string');
    expect(data.url).toMatch(/\/api\/a2a\/test-agent$/);
    expect(typeof data.protocolVersion).toBe('string');
    expect(data.capabilities).toBeDefined();
    expect(Array.isArray(data.skills)).toBe(true);

    // The fixture agent exposes the calculator + string-transform tools as skills.
    const skillIds = new Set(data.skills.map((s) => s.id));
    expect(skillIds.has('calculator')).toBe(true);
    expect(skillIds.has('string-transform')).toBe(true);
  });

  it('GET /.well-known/:agentId/agent-card.json returns 404 for an unknown agent', async () => {
    const { status, data } = await fetchJson<{ error: string }>(
      '/api/.well-known/does-not-exist-smoke/agent-card.json',
    );
    expect(status).toBe(404);
    expect(typeof data.error).toBe('string');
    expect(data.error).toMatch(/does-not-exist-smoke/);
  });
});

describe('A2A — JSON-RPC message bus', () => {
  it('POST /a2a/:agentId with message/send returns a JSON-RPC result with assistant artifacts @llm', async () => {
    const { status, data } = await fetchJson<{
      jsonrpc: string;
      id: string;
      result: {
        id: string;
        status: { state: string };
        artifacts: Array<{ parts: Array<{ kind: string; text?: string }> }>;
        history: Array<unknown>;
      };
    }>('/api/a2a/test-agent', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'smoke-1',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Say "hello" and nothing else.' }],
            messageId: 'smoke-msg-1',
            kind: 'message',
          },
        },
      }),
    });

    expect(status).toBe(200);
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe('smoke-1');
    expect(data.result).toBeDefined();
    expect(typeof data.result.id).toBe('string');
    expect(data.result.status.state).toBe('completed');
    expect(Array.isArray(data.result.artifacts)).toBe(true);
    expect(data.result.artifacts.length).toBeGreaterThan(0);
    expect(Array.isArray(data.result.history)).toBe(true);
    expect(data.result.history.length).toBeGreaterThan(0);

    // At least one artifact part should carry text content from the LLM.
    const textParts = data.result.artifacts.flatMap((a) =>
      a.parts.filter((p) => p.kind === 'text' && typeof p.text === 'string'),
    );
    expect(textParts.length).toBeGreaterThan(0);
  }, 45_000);

  it('POST /a2a/:agentId rejects a payload with an unknown JSON-RPC method', async () => {
    const { status, data } = await fetchJson<{ error: string; issues: Array<{ field: string }> }>(
      '/api/a2a/test-agent',
      {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'smoke-bad-method',
          method: 'does/not/exist',
          params: {},
        }),
      },
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Invalid request body');
    expect(Array.isArray(data.issues)).toBe(true);
    expect(data.issues.some((i) => i.field === 'method')).toBe(true);
  });

  it('POST /a2a/:agentId returns 404 for an unknown agent', async () => {
    const { status, data } = await fetchJson<{ error: string }>('/api/a2a/does-not-exist-smoke', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'smoke-2',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'hi' }],
            messageId: 'smoke-msg-2',
            kind: 'message',
          },
        },
      }),
    });
    expect(status).toBe(404);
    expect(typeof data.error).toBe('string');
    expect(data.error).toMatch(/does-not-exist-smoke/);
  });
});
