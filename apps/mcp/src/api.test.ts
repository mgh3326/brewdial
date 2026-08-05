import { describe, it, expect } from 'vitest';
import { getJson, postJson, patchJson, ApiError } from './api.js';
import type { ApiConfig } from './config.js';

const config: ApiConfig = {
  baseUrl: 'https://api.brewdial.example.com',
  agentToken: 'test-agent-token',
};

interface Call {
  url: string;
  init: RequestInit & { headers?: Record<string, string> };
}

function fetchReturning(status: number, body: unknown, calls?: Call[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls?.push({ url: String(url), init: (init ?? {}) as Call['init'] });
    const text = body === undefined ? '' : JSON.stringify(body);
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('getJson', () => {
  it('GETs the path with Bearer auth header and returns parsed JSON', async () => {
    const calls: Call[] = [];
    const result = await getJson(
      config,
      '/api/recipes',
      'limit=2',
      fetchReturning(200, [{ code: 'COF-0001' }, { code: 'COF-0002' }], calls)
    );
    expect(result).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.brewdial.example.com/api/recipes?limit=2');
    expect(calls[0].init.method).toBe('GET');
    expect((calls[0].init.headers as Record<string, string>)?.Authorization).toBe('Bearer test-agent-token');
  });

  it('GETs without query string when query is empty', async () => {
    const calls: Call[] = [];
    await getJson(config, '/api/agent/preferences/global', '', fetchReturning(200, null, calls));
    expect(calls[0].url).toBe('https://api.brewdial.example.com/api/agent/preferences/global');
  });

  it('returns undefined for an empty body', async () => {
    const result = await getJson(config, '/api/grinders', '', fetchReturning(200, undefined));
    expect(result).toBeUndefined();
  });
});

describe('postJson', () => {
  it('POSTs with Bearer auth and JSON body, returns parsed response', async () => {
    const calls: Call[] = [];
    const row = await postJson(
      config,
      '/api/agent/recipes',
      { method: 'v60', title: 'Test Recipe' },
      fetchReturning(201, { code: 'COF-0001', method: 'v60', title: 'Test Recipe' }, calls)
    );
    expect(row).toMatchObject({ code: 'COF-0001' });
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ method: 'v60', title: 'Test Recipe' });
    expect((calls[0].init.headers as Record<string, string>)?.Authorization).toBe('Bearer test-agent-token');
  });

  it('POSTs global preferences to the agent preferences endpoint', async () => {
    const calls: Call[] = [];
    await postJson(
      config,
      '/api/agent/preferences/global',
      { likes: ['저산미'], dislikes: ['고산미'] },
      fetchReturning(200, { likes: ['저산미'], dislikes: ['고산미'] }, calls)
    );
    expect(calls[0].url).toBe('https://api.brewdial.example.com/api/agent/preferences/global');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ likes: ['저산미'], dislikes: ['고산미'] });
    expect((calls[0].init.headers as Record<string, string>)?.Authorization).toBe('Bearer test-agent-token');
  });
});

describe('patchJson', () => {
  it('PATCHes the path with Bearer auth and JSON body', async () => {
    const calls: Call[] = [];
    const row = await patchJson(
      config,
      '/api/agent/recipes/COF-0001',
      { status: 'archived' },
      fetchReturning(200, { code: 'COF-0001', status: 'archived' }, calls)
    );
    expect(row).toMatchObject({ code: 'COF-0001', status: 'archived' });
    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ status: 'archived' });
  });
});

describe('ApiError', () => {
  it('throws ApiError on a 4xx response', async () => {
    await expect(
      getJson(config, '/api/recipes', '', fetchReturning(403, { message: 'denied' }))
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError on a 5xx response', async () => {
    await expect(
      postJson(config, '/api/agent/feedback', { recipeCode: 'COF-0001' }, fetchReturning(500, { error: 'server error' }))
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('ApiError carries status and body', async () => {
    let caught: ApiError | null = null;
    try {
      await getJson(config, '/api/agent/recipes/COF-9999', '', fetchReturning(404, { error: 'not found' }));
    } catch (e) {
      caught = e as ApiError;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(404);
    expect(caught?.body).toMatchObject({ error: 'not found' });
  });
});

describe('Authorization header', () => {
  it('sends the Bearer token on every request method', async () => {
    const testCases = [
      { fn: () => getJson(config, '/api/test', '', fetchReturning(200, {}) as typeof fetch) },
      { fn: () => postJson(config, '/api/test', {}, fetchReturning(201, {}) as typeof fetch) },
      { fn: () => patchJson(config, '/api/test', {}, fetchReturning(200, {}) as typeof fetch) },
    ];
    for (const { fn } of testCases) {
      const calls: Call[] = [];
      const mockFetch = fetchReturning(200, {}, calls);
      const getFn = fn.toString().includes('getJson')
        ? () => getJson(config, '/api/test', '', mockFetch)
        : fn.toString().includes('postJson')
          ? () => postJson(config, '/api/test', {}, mockFetch)
          : () => patchJson(config, '/api/test', {}, mockFetch);
      await getFn();
      // All calls should have Bearer token
    }
    // Simpler: just verify directly
    const getCalls: Call[] = [];
    await getJson(config, '/api/x', '', fetchReturning(200, null, getCalls));
    expect((getCalls[0].init.headers as Record<string, string>)?.Authorization).toBe('Bearer test-agent-token');

    const postCalls: Call[] = [];
    await postJson(config, '/api/x', {}, fetchReturning(200, null, postCalls));
    expect((postCalls[0].init.headers as Record<string, string>)?.Authorization).toBe('Bearer test-agent-token');

    const patchCalls: Call[] = [];
    await patchJson(config, '/api/x', {}, fetchReturning(200, null, patchCalls));
    expect((patchCalls[0].init.headers as Record<string, string>)?.Authorization).toBe('Bearer test-agent-token');
  });
});
