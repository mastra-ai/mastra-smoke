import { describe, expect, it } from 'vitest';
import { fetchJson } from '../utils.js';

// The embedders endpoint advertises the embedding models the server can reach.
// The smoke fixture doesn't wire up a vector store, but the registry of
// well-known embedders (OpenAI text-embedding-3-*, etc.) is still served.

describe('embedders endpoint', () => {
  it('GET /embedders returns a registry of known embedders', async () => {
    const { status, data } = await fetchJson<any>('/api/embedders');
    expect(status).toBe(200);
    expect(Array.isArray(data.embedders)).toBe(true);
    // The default registry always advertises at least the OpenAI embedders.
    expect(data.embedders.length).toBeGreaterThan(0);

    const sample = data.embedders[0];
    expect(typeof sample.id).toBe('string');
    expect(typeof sample.provider).toBe('string');
    expect(typeof sample.dimensions).toBe('number');
  });
});
