// Tests for the identity-scoped miniapp write modules.
// The public recipe, feedback, and preference writes are intentionally absent;
// these tests protect the four remaining visitor-storage writes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setApiBaseUrl } from '../api';

const BASE = 'https://test.brewdial.invalid';
const TEST_IDENTITY = { provider: 'toss_anon' as const, externalKey: 'toss-hash-abcdefghij1234' };

vi.mock('../identity', () => ({
  resolveIdentity: vi.fn().mockResolvedValue(TEST_IDENTITY),
}));

function mockFetch(status: number, body: unknown): void {
  const text = JSON.stringify(body);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(text),
    }),
  );
}

function lastFetchCall(): { url: string; init: RequestInit } {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const last = calls[calls.length - 1];
  return { url: last[0] as string, init: last[1] as RequestInit };
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  setApiBaseUrl(BASE);
  vi.unstubAllGlobals();
});

describe('saveRecipe', () => {
  it('POSTs /me/saved-recipes with the recipe code and identity header', async () => {
    mockFetch(201, { ok: true });
    const { saveRecipe } = await import('./user-content');
    await saveRecipe('COF-001');

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/saved-recipes`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'COF-001', note: null });
    expect(headersOf(init)['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
  });

  it('includes an optional note', async () => {
    mockFetch(201, { ok: true });
    const { saveRecipe } = await import('./user-content');
    await saveRecipe('COF-002', 'my note');
    expect(JSON.parse(lastFetchCall().init.body as string).note).toBe('my note');
  });
});

describe('saveBean', () => {
  it('POSTs /me/saved-beans with the bean id and identity header', async () => {
    mockFetch(201, { ok: true });
    const { saveBean } = await import('./user-content');
    await saveBean('bean-42');

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/saved-beans`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ beanId: 'bean-42' });
    expect(headersOf(init)['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
  });
});

describe('getMyCollections', () => {
  it('GETs /me/collections with identity and preserves the composite shape', async () => {
    mockFetch(200, {
      savedRecipes: [{ code: 'COF-001' }],
      savedBeans: ['bean-1'],
      gear: [{ kind: 'grinder', label: 'C40' }],
      calibration: [],
      myRecipes: ['COF-005'],
    });
    const { getMyCollections } = await import('./user-content');
    const result = await getMyCollections();

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/collections`);
    expect(init.method).toBe('GET');
    expect(headersOf(init)['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
    expect(result).toEqual({
      savedRecipes: [{ code: 'COF-001' }],
      savedBeans: ['bean-1'],
      gear: [{ kind: 'grinder', label: 'C40' }],
      calibration: [],
      myRecipes: ['COF-005'],
    });
  });

  it('defaults absent collections arrays to empty arrays', async () => {
    mockFetch(200, {});
    const { getMyCollections } = await import('./user-content');
    await expect(getMyCollections()).resolves.toEqual({
      savedRecipes: [],
      savedBeans: [],
      gear: [],
      calibration: [],
      myRecipes: [],
    });
  });
});

describe('upsertGear', () => {
  it('PUTs /me/gear with the gear body and identity header', async () => {
    mockFetch(200, { ok: true, id: 'gear-uuid-123' });
    const { upsertGear } = await import('./user-content');
    await expect(upsertGear({ kind: 'grinder', label: 'Commandante C40', isDefault: true })).resolves.toBe('gear-uuid-123');

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/gear`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: 'grinder', label: 'Commandante C40', isDefault: true });
    expect(headersOf(init)['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
  });

  it('returns null when the backend returns a null id', async () => {
    mockFetch(200, { ok: true, id: null });
    const { upsertGear } = await import('./user-content');
    await expect(upsertGear({ kind: 'dripper', label: 'V60' })).resolves.toBeNull();
  });
});

describe('upsertCalibration', () => {
  it('PUTs /me/calibration with samples and identity header', async () => {
    mockFetch(200, { ok: true, id: 'cal-uuid-456' });
    const { upsertCalibration } = await import('./user-content');
    const result = await upsertCalibration({
      fromLabel: 'C40',
      toLabel: 'Niche Zero',
      samples: [{ fromClicks: 20, toClicks: 15 }],
      source: 'measured',
    });

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/calibration`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      fromLabel: 'C40',
      toLabel: 'Niche Zero',
      samples: [{ fromClicks: 20, toClicks: 15 }],
      source: 'measured',
    });
    expect(headersOf(init)['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
    expect(result).toBe('cal-uuid-456');
  });
});
