import { describe, expect, it } from 'vitest';
import { fetchJson } from '../utils.js';

// The smoke fixture does not configure a vector store, so the index/query/upsert
// endpoints are gated. We still want a sanity check that the top-level
// `/vectors` listing returns an empty registry instead of crashing.

describe('vectors listing', () => {
  it('GET /vectors returns an empty registry in the smoke fixture', async () => {
    const { status, data } = await fetchJson<any>('/api/vectors');
    expect(status).toBe(200);
    expect(Array.isArray(data.vectors)).toBe(true);
    expect(data.vectors.length).toBe(0);
  });
});
