import { describe, it, expect, assert, beforeAll, afterAll } from 'vitest';
import { MCPClient } from '@mastra/mcp';
import { noopObserve } from '@mastra/core/tools';
import { getBaseUrl } from '../utils.js';

describe('MCP client transport', () => {
  describe('Streamable HTTP transport', () => {
    let client: MCPClient;

    beforeAll(async () => {
      const baseUrl = getBaseUrl();
      client = new MCPClient({
        id: 'smoke-http',
        servers: {
          'test-mcp': {
            url: new URL(`${baseUrl}/api/mcp/test-mcp/mcp`),
          },
        },
      });
    });

    afterAll(async () => {
      await client?.disconnect();
    });

    it('should connect and list tools via Streamable HTTP', async () => {
      const tools = await client.listTools();

      // Tools are namespaced as serverName_toolName
      const toolNames = Object.keys(tools);
      expect(toolNames).toContain('test-mcp_calculator');
      expect(toolNames).toContain('test-mcp_string-transform');
    });

    it('should execute calculator tool via Streamable HTTP', async () => {
      const tools = await client.listTools();
      const calculator = tools['test-mcp_calculator'];
      expect(calculator, 'calculator tool not found').toBeDefined();
      assert(calculator.execute, 'calculator tool has no execute method');

      const result = await calculator.execute({ operation: 'add', a: 10, b: 32 }, { observe: noopObserve });

      // When the tool throws server-side, MCP wraps the failure in
      // { content: [...], isError: true }. Surface that content in the
      // assertion message so CI logs tell us *why* the tool threw.
      expect(result, `MCP returned error envelope: ${JSON.stringify(result)}`).toEqual({ result: 42 });
    });

    it('should execute string-transform tool via Streamable HTTP', async () => {
      const tools = await client.listTools();
      const transform = tools['test-mcp_string-transform'];
      expect(transform, 'string-transform tool not found').toBeDefined();
      assert(transform.execute, 'string-transform tool has no execute method');

      const result = await transform.execute({ text: 'hello world', transform: 'upper' }, { observe: noopObserve });

      expect(result, `MCP returned error envelope: ${JSON.stringify(result)}`).toEqual({ result: 'HELLO WORLD' });
    });
  });

  describe('legacy HTTP+SSE transport (removed in @mastra/mcp 2.x)', () => {
    // MCP 2026-07-28 servers are self-contained per request; the standalone
    // SSE transport was removed upstream (mastra-ai/mastra#23876). Lock in the
    // explicit refusal rather than a vacuous "lists no tools" check.
    it('refuses the legacy /sse endpoint with an explicit v2 error', async () => {
      const res = await fetch(`${getBaseUrl()}/api/mcp/test-mcp/sse`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Legacy SSE transport is unavailable for MCP v2 servers');
    });
  });
});
