import { describe, expect, it } from 'vitest';
import { fetchJson } from '../utils.js';

// The embedders endpoint advertises the embedding models the server can reach.
// The smoke fixture doesn't wire up a vector store, but the registry of
// well-known embedders is still served and forms a public contract.

describe('embedders endpoint', () => {
  it('GET /embedders returns the known embedder registry with full shape', async () => {
    const { status, data } = await fetchJson<{
      embedders: Array<{
        id: string;
        provider: string;
        name: string;
        description: string;
        dimensions: number;
        maxInputTokens: number;
      }>;
    }>('/api/embedders');

    expect(status).toBe(200);
    expect(Array.isArray(data.embedders)).toBe(true);

    // Each entry must carry the full advertised shape — third-party tooling
    // (e.g. the Studio embedder picker) relies on every field.
    for (const e of data.embedders) {
      expect(typeof e.id).toBe('string');
      expect(typeof e.provider).toBe('string');
      expect(typeof e.name).toBe('string');
      expect(typeof e.description).toBe('string');
      expect(typeof e.dimensions).toBe('number');
      expect(e.dimensions).toBeGreaterThan(0);
      expect(typeof e.maxInputTokens).toBe('number');
      expect(e.maxInputTokens).toBeGreaterThan(0);
    }

    // The OpenAI registry must always be present.
    const ids = data.embedders.map((e) => e.id);
    expect(ids).toContain('openai/text-embedding-3-small');
    expect(ids).toContain('openai/text-embedding-3-large');

    const small = data.embedders.find((e) => e.id === 'openai/text-embedding-3-small')!;
    expect(small.provider).toBe('openai');
    expect(small.dimensions).toBe(1536);
  });
});
