import { describe, expect, it } from 'vitest';
import { fetchApi, fetchJson } from '../utils.js';

describe('editor builder — discovery surface', () => {
  it('GET /api/editor/builder/registries lists the skills-sh registry as disabled', async () => {
    const { status, data } = await fetchJson<{
      registries: Array<{ id: string; enabled: boolean; label: string }>;
    }>('/api/editor/builder/registries');

    expect(status).toBe(200);
    expect(Array.isArray(data.registries)).toBe(true);
    const skillsSh = data.registries.find((r) => r.id === 'skills-sh');
    expect(skillsSh, 'skills-sh registry should be returned').toBeDefined();
    expect(skillsSh!.enabled).toBe(false);
    expect(skillsSh!.label).toBe('skills.sh');
  });

  it('GET /api/editor/builder/settings reflects the disabled model policy in the smoke fixture', async () => {
    const { status, data } = await fetchJson<{
      enabled: boolean;
      modelPolicy: { active: boolean };
    }>('/api/editor/builder/settings');

    expect(status).toBe(200);
    expect(data.enabled).toBe(false);
    expect(data.modelPolicy.active).toBe(false);
  });

  it('GET /api/editor/builder/infrastructure reports the smoke-stub channel and unregistered browser/workspace', async () => {
    const { status, data } = await fetchJson<{
      channels: {
        providers: Array<{
          id: string;
          name: string;
          isConfigured: boolean;
          routeCount: number;
        }>;
      };
      browser: { registered: boolean; type: unknown; provider: unknown };
      workspace: {
        registered: boolean;
        hasFilesystem: boolean;
        hasSandbox: boolean;
      };
      registries: { skillsSh: { enabled: boolean } };
    }>('/api/editor/builder/infrastructure');

    expect(status).toBe(200);
    const stub = data.channels.providers.find((p) => p.id === 'smoke-stub');
    expect(stub, 'smoke-stub channel provider should be returned').toBeDefined();
    expect(stub!.name).toBe('Smoke Stub');
    expect(stub!.isConfigured).toBe(true);
    expect(stub!.routeCount).toBe(0);

    expect(data.browser.registered).toBe(false);
    expect(data.browser.type).toBe(null);
    expect(data.browser.provider).toBe(null);

    expect(data.workspace.registered).toBe(false);
    expect(data.workspace.hasFilesystem).toBe(false);
    expect(data.workspace.hasSandbox).toBe(false);

    expect(data.registries.skillsSh.enabled).toBe(false);
  });
});

describe('editor builder — registries gated when disabled', () => {
  it('GET /api/editor/builder/registries/skills-sh/popular returns "Registry not found" when disabled', async () => {
    const res = await fetchApi('/api/editor/builder/registries/skills-sh/popular');
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Registry not found');
  });

  it('GET /api/editor/builder/registries/skills-sh/search returns "Registry not found" when disabled', async () => {
    const res = await fetchApi(
      '/api/editor/builder/registries/skills-sh/search?q=foo',
    );
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Registry not found');
  });

  it('GET /api/editor/builder/registries/skills-sh/preview rejects a missing owner/repo with a structured 400', async () => {
    const res = await fetchApi(
      '/api/editor/builder/registries/skills-sh/preview',
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as {
      error: string;
      issues: Array<{ field: string; message: string }>;
    };
    expect(data.error).toBe('Invalid query parameters');
    expect(data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'owner', message: expect.any(String) }),
        expect.objectContaining({ field: 'repo', message: expect.any(String) }),
        expect.objectContaining({ field: 'path', message: expect.any(String) }),
      ]),
    );
  });

  it('POST /api/editor/builder/registries/skills-sh/install rejects a missing body with a structured 400', async () => {
    const res = await fetchApi(
      '/api/editor/builder/registries/skills-sh/install',
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as {
      error: string;
      issues: Array<{ field: string; message: string }>;
    };
    expect(data.error).toBe('Invalid request body');
    expect(data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'owner', message: expect.any(String) }),
        expect.objectContaining({ field: 'repo', message: expect.any(String) }),
        expect.objectContaining({ field: 'skillName', message: expect.any(String) }),
      ]),
    );
  });
});
