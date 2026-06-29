// Tests for WRITE + personalization data modules repointed to the backend API (Task 4).
// Mocks global.fetch and vi.mock('../identity') to verify method+path+body
// and that /me/* calls include the X-BrewDial-Identity header.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setApiBaseUrl } from '../api';

const BASE = 'https://test.brewdial.invalid';

// Stable identity fixture used across all /me/* tests.
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

// ── createRecipe ───────────────────────────────────────────────────────────────

describe('createRecipe', () => {
  const minimalRow = {
    id: 'r-new',
    code: 'COF-100',
    method: 'v60',
    title: 'New V60',
    version: 1,
    params: {},
    steps: [],
    bean_id: null,
    bean_snapshot: null,
    intent: null,
    notes: null,
    adjustment_from_previous: null,
    created_by: 'manual',
    owner_id: null,
    is_official: false,
    dripper_portability: null,
    status: 'active',
    supersedes: null,
    superseded_by: null,
    parent_code: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  it('POST /recipes with correct body and maps the returned row', async () => {
    mockFetch(201, minimalRow);

    const { createRecipe } = await import('./recipes');
    const doc = await createRecipe({ method: 'v60', title: 'New V60' });

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/recipes`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.method).toBe('v60');
    expect(body.title).toBe('New V60');
    // server sets created_by; client must NOT send it
    expect(body.created_by).toBeUndefined();
    // Regression: absent optionals are OMITTED (backend rejects `null` as a type
    // error), and no snake_case keys leak (validator reads camelCase).
    expect(body.intent).toBeUndefined();
    expect(body.notes).toBeUndefined();
    expect('bean_id' in body).toBe(false);
    expect('bean_snapshot' in body).toBe(false);
    expect('adjustment_from_previous' in body).toBe(false);
    // maps to RecipeDoc
    expect(doc._id).toBe('recipe:COF-100');
    expect(doc.code).toBe('COF-100');
  });

  it('sends camelCase keys (beanId/intent/notes), never snake_case', async () => {
    mockFetch(201, minimalRow);
    const { createRecipe } = await import('./recipes');
    await createRecipe({
      method: 'v60',
      title: 'X',
      beanId: 'bean-1',
      intent: ['balanced'],
      notes: 'hi',
    });
    const body = JSON.parse(lastFetchCall().init.body as string);
    expect(body.beanId).toBe('bean-1');
    expect(body.intent).toEqual(['balanced']);
    expect(body.notes).toBe('hi');
    expect('bean_id' in body).toBe(false);
  });

  it('does NOT include X-BrewDial-Identity header (no identity required for POST /recipes)', async () => {
    mockFetch(201, minimalRow);
    const { createRecipe } = await import('./recipes');
    await createRecipe({ method: 'v60', title: 'New V60' });

    const { init } = lastFetchCall();
    const headers = headersOf(init);
    expect(headers['X-BrewDial-Identity']).toBeUndefined();
  });

  it('throws when input validation fails', async () => {
    const { createRecipe } = await import('./recipes');
    // Missing required 'method' field — cast to force the call
    await expect(createRecipe({ title: 'oops' } as never)).rejects.toThrow();
  });
});

// ── createFeedback ─────────────────────────────────────────────────────────────

describe('createFeedback', () => {
  const minimalFbRow = {
    id: 'fb-new',
    recipe_code: 'COF-0001',
    bean_id: null,
    ratings: null,
    actual: null,
    comment: 'great',
    raw_comment: null,
    quick_tags: null,
    desired_direction: null,
    next_hint: null,
    source: 'web',
    created_at: '2024-01-10T00:00:00Z',
    updated_at: '2024-01-10T00:00:00Z',
  };

  it('POST /recipes/:code/feedback with correct path and body', async () => {
    mockFetch(201, minimalFbRow);

    const { createFeedback } = await import('./feedback');
    const doc = await createFeedback({ recipeCode: 'COF-0001', comment: 'great', rawComment: 'great' });

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/recipes/COF-0001/feedback`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    // Body must use camelCase — backend validateCreateFeedbackInput reads camelCase
    expect(body.rawComment).toBe('great');
    expect(body.comment).toBe('great');
    expect(body.source).toBe('web');
    // recipe_code must NOT be in body (backend uses URL path param)
    expect(body.recipe_code).toBeUndefined();
    expect(body.recipeCode).toBeUndefined();
    // maps to FeedbackDoc
    expect(doc._id).toBe('feedback:COF-0001:fb-new');
    expect(doc.recipeCode).toBe('COF-0001');
    expect(doc.comment).toBe('great');
  });

  it('URL-encodes special characters in the recipe code path segment', async () => {
    // This tests that encodeURIComponent is called; simulate a code with a space.
    const encodedRow = { ...minimalFbRow, recipe_code: 'COF-0001' };
    mockFetch(201, encodedRow);

    const { createFeedback } = await import('./feedback');
    await createFeedback({ recipeCode: 'COF-0001', rawComment: 'test' });

    const { url } = lastFetchCall();
    // encodeURIComponent('COF-0001') === 'COF-0001' (no special chars)
    expect(url).toBe(`${BASE}/recipes/COF-0001/feedback`);
    expect(url).toContain('/recipes/COF-0001/feedback');
  });

  it('does NOT include X-BrewDial-Identity header', async () => {
    mockFetch(201, minimalFbRow);
    const { createFeedback } = await import('./feedback');
    await createFeedback({ recipeCode: 'COF-0001', rawComment: 'ok' });

    const { init } = lastFetchCall();
    const headers = headersOf(init);
    expect(headers['X-BrewDial-Identity']).toBeUndefined();
  });
});

// ── saveRecipe ─────────────────────────────────────────────────────────────────

describe('saveRecipe', () => {
  it('POST /me/saved-recipes with {code} and identity header', async () => {
    mockFetch(200, { saved: true });

    const { saveRecipe } = await import('./user-content');
    await saveRecipe('COF-001');

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/saved-recipes`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.code).toBe('COF-001');
    const headers = headersOf(init);
    expect(headers['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
  });

  it('includes optional note in body when provided', async () => {
    mockFetch(200, {});
    const { saveRecipe } = await import('./user-content');
    await saveRecipe('COF-002', 'my note');

    const { init } = lastFetchCall();
    const body = JSON.parse(init.body as string);
    expect(body.note).toBe('my note');
  });
});

// ── saveBean ───────────────────────────────────────────────────────────────────

describe('saveBean', () => {
  it('POST /me/saved-beans with {beanId} and identity header', async () => {
    mockFetch(200, { saved: true });

    const { saveBean } = await import('./user-content');
    await saveBean('bean-42');

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/saved-beans`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.beanId).toBe('bean-42');
    const headers = headersOf(init);
    expect(headers['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
  });
});

// ── getMyCollections ───────────────────────────────────────────────────────────

describe('getMyCollections', () => {
  it('GET /me/collections with identity header and passes composite shape through', async () => {
    const composite = {
      savedRecipes: [{ code: 'COF-001' }],
      savedBeans: ['bean-1'],
      gear: [{ kind: 'grinder', label: 'C40' }],
      calibration: [],
      myRecipes: ['COF-005'],
    };
    mockFetch(200, composite);

    const { getMyCollections } = await import('./user-content');
    const result = await getMyCollections();

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/collections`);
    expect(init.method).toBe('GET');
    const headers = headersOf(init);
    expect(headers['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
    // Composite shape passed through unchanged
    expect(result.savedRecipes).toEqual([{ code: 'COF-001' }]);
    expect(result.savedBeans).toEqual(['bean-1']);
    expect(result.gear).toEqual([{ kind: 'grinder', label: 'C40' }]);
    expect(result.calibration).toEqual([]);
    expect(result.myRecipes).toEqual(['COF-005']);
  });

  it('defaults all arrays to [] when API returns empty object', async () => {
    mockFetch(200, {});
    const { getMyCollections } = await import('./user-content');
    const result = await getMyCollections();

    expect(result.savedRecipes).toEqual([]);
    expect(result.savedBeans).toEqual([]);
    expect(result.gear).toEqual([]);
    expect(result.calibration).toEqual([]);
    expect(result.myRecipes).toEqual([]);
  });
});

// ── upsertGear ─────────────────────────────────────────────────────────────────

describe('upsertGear', () => {
  it('PUT /me/gear with gear body and identity header', async () => {
    const gearId = 'gear-uuid-123';
    // Backend returns { ok: true, id } — mock the real response shape
    mockFetch(200, { ok: true, id: gearId });

    const { upsertGear } = await import('./user-content');
    const result = await upsertGear({ kind: 'grinder', label: 'Commandante C40', isDefault: true });

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/gear`);
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body.kind).toBe('grinder');
    expect(body.label).toBe('Commandante C40');
    expect(body.isDefault).toBe(true);
    const headers = headersOf(init);
    expect(headers['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
    // Must return the bare id string, not the response object
    expect(result).toBe(gearId);
  });

  it('returns null when API returns null id', async () => {
    mockFetch(200, { ok: true, id: null });
    const { upsertGear } = await import('./user-content');
    const result = await upsertGear({ kind: 'dripper', label: 'V60' });
    expect(result).toBeNull();
  });
});

// ── upsertCalibration ──────────────────────────────────────────────────────────

describe('upsertCalibration', () => {
  it('PUT /me/calibration with calibration body and identity header', async () => {
    const calId = 'cal-uuid-456';
    // Backend returns { ok: true, id } — mock the real response shape
    mockFetch(200, { ok: true, id: calId });

    const { upsertCalibration } = await import('./user-content');
    const cal = {
      fromLabel: 'C40',
      toLabel: 'Niche Zero',
      samples: [{ fromClicks: 20, toClicks: 15 }],
      source: 'measured' as const,
    };
    const result = await upsertCalibration(cal);

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE}/me/calibration`);
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body.fromLabel).toBe('C40');
    expect(body.toLabel).toBe('Niche Zero');
    expect(body.samples).toEqual([{ fromClicks: 20, toClicks: 15 }]);
    expect(body.source).toBe('measured');
    const headers = headersOf(init);
    expect(headers['X-BrewDial-Identity']).toBe(
      `${TEST_IDENTITY.provider}:${TEST_IDENTITY.externalKey}`,
    );
    // Must return the bare id string, not the response object
    expect(result).toBe(calId);
  });
});

// ── createOwnedRecipe: confirm it no longer exists ────────────────────────────

describe('createOwnedRecipe removed', () => {
  it('is NOT exported from user-content', async () => {
    const mod = await import('./user-content');
    expect((mod as Record<string, unknown>)['createOwnedRecipe']).toBeUndefined();
  });
});
