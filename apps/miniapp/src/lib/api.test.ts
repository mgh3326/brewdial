import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setApiBaseUrl, apiGet, apiGetOrNull, apiSend, ApiError } from './api';

const BASE = 'https://test.brewdial.invalid';

// Minimal Identity fixture
const identity = { provider: 'toss_anon' as const, externalKey: 'test-key-abcdefghij' };

function mockFetch(status: number, body?: unknown): void {
  const responseText =
    body !== undefined
      ? typeof body === 'string'
        ? body
        : JSON.stringify(body)
      : '';
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(responseText),
    }),
  );
}

beforeEach(() => {
  setApiBaseUrl(BASE);
  vi.unstubAllGlobals();
});

// ── apiGet ─────────────────────────────────────────────────────────────────────

describe('apiGet', () => {
  it('calls GET ${base}${path} and parses JSON', async () => {
    const recipes = [{ id: 1, title: 'V60' }];
    mockFetch(200, recipes);

    const result = await apiGet<typeof recipes>('/recipes');

    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/recipes`, {
      method: 'GET',
      headers: {},
      body: undefined,
    });
    expect(result).toEqual(recipes);
  });

  it('respects setApiBaseUrl override', async () => {
    const altBase = 'https://alt.brewdial.invalid';
    setApiBaseUrl(altBase);
    mockFetch(200, { ok: true });

    await apiGet('/ping');

    expect(global.fetch).toHaveBeenCalledWith(
      `${altBase}/ping`,
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

// ── apiGetOrNull ───────────────────────────────────────────────────────────────

describe('apiGetOrNull', () => {
  it('returns parsed JSON on 200', async () => {
    const data = { id: 'r1', title: 'V60' };
    mockFetch(200, data);

    const result = await apiGetOrNull<typeof data>('/recipes/r1');
    expect(result).toEqual(data);
  });

  it('returns null on 404', async () => {
    mockFetch(404, 'not found');

    const result = await apiGetOrNull('/recipes/missing');
    expect(result).toBeNull();
  });

  it('throws ApiError on 500 (not swallowed as null)', async () => {
    mockFetch(500, 'internal server error');

    await expect(apiGetOrNull('/recipes/r1')).rejects.toBeInstanceOf(ApiError);
    await expect(apiGetOrNull('/recipes/r1')).rejects.toMatchObject({ status: 500 });
  });

  it('throws ApiError on 401 (not swallowed as null)', async () => {
    mockFetch(401, 'unauthorized');

    await expect(apiGetOrNull('/me/profile')).rejects.toBeInstanceOf(ApiError);
    await expect(apiGetOrNull('/me/profile')).rejects.toMatchObject({ status: 401 });
  });
});

// ── apiSend ────────────────────────────────────────────────────────────────────

describe('apiSend', () => {
  it('POST sets X-BrewDial-Identity header and JSON body', async () => {
    const code = 'SAVE_001';
    mockFetch(200, { saved: true });

    await apiSend('POST', '/me/saved-recipes', { code }, { identity });

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/me/saved-recipes`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-BrewDial-Identity': `toss_anon:${identity.externalKey}`,
        }),
        body: JSON.stringify({ code }),
      }),
    );
  });

  it('omits X-BrewDial-Identity when no identity provided', async () => {
    mockFetch(201, {});

    await apiSend('POST', '/recipes', { title: 'test' });

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers['X-BrewDial-Identity']).toBeUndefined();
  });

  it('sends identity header as provider:externalKey format', async () => {
    const webId = { provider: 'web_local' as const, externalKey: 'web-uuid-1234567890' };
    mockFetch(200, {});

    await apiSend('PUT', '/me/profile', {}, { identity: webId });

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers['X-BrewDial-Identity']).toBe(`web_local:${webId.externalKey}`);
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws ApiError on 500', async () => {
    mockFetch(500, 'internal server error');

    await expect(apiGet('/recipes')).rejects.toBeInstanceOf(ApiError);
    await expect(apiGet('/recipes')).rejects.toMatchObject({ status: 500 });
  });

  it('throws ApiError on 401 with permission/login message', async () => {
    mockFetch(401, 'unauthorized');

    const err = await apiGet('/me').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    // Message must match localizeMessage's 'permission' branch
    expect((err as ApiError).message).toMatch(/permission/i);
  });

  it('throws ApiError on 404', async () => {
    mockFetch(404, 'not found');

    await expect(apiGet('/unknown')).rejects.toBeInstanceOf(ApiError);
    await expect(apiGet('/unknown')).rejects.toMatchObject({ status: 404 });
  });

  it('returns undefined for 204 No Content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      }),
    );

    const result = await apiSend('DELETE', '/me/saved-recipes/1');
    expect(result).toBeUndefined();
  });
});
