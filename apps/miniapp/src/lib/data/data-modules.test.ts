// Tests for READ data modules repointed to the backend API (Task 3).
// Each test mocks global.fetch and verifies the correct path is called
// and that the returned rows are mapped through the existing mappers.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setApiBaseUrl } from '../api';

const BASE = 'https://test.brewdial.invalid';

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

beforeEach(() => {
  setApiBaseUrl(BASE);
  vi.unstubAllGlobals();
});

// ── recipes ────────────────────────────────────────────────────────────────────

describe('listRecentRecipes', () => {
  it('calls GET /recipes?limit=N and maps rows to RecipeDoc[]', async () => {
    const row = {
      id: 'r1',
      code: 'COF-001',
      method: 'v60',
      title: 'V60 Test',
      version: 1,
      params: null,
      steps: null,
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
    mockFetch(200, [row]);

    const { listRecentRecipes } = await import('./recipes');
    const docs = await listRecentRecipes(20);

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/recipes?limit=20`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]._id).toBe('recipe:COF-001');
    expect(docs[0].type).toBe('recipe');
    expect(docs[0].code).toBe('COF-001');
    expect(docs[0].method).toBe('v60');
    expect(docs[0].title).toBe('V60 Test');
  });

  it('clamps limit to DEFAULT_LIMIT=20 when not provided', async () => {
    mockFetch(200, []);
    const { listRecentRecipes } = await import('./recipes');
    await listRecentRecipes();
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('limit=20');
  });
});

describe('getRecipeByCode', () => {
  it('calls GET /recipes/:code and maps single row', async () => {
    const row = {
      id: 'r2',
      code: 'COF-002',
      method: 'aeropress',
      title: 'Aeropress Test',
      version: 2,
      params: null,
      steps: null,
      bean_id: 'bean-1',
      bean_snapshot: null,
      intent: null,
      notes: null,
      adjustment_from_previous: null,
      created_by: 'agent',
      owner_id: null,
      is_official: true,
      dripper_portability: null,
      status: 'active',
      supersedes: null,
      superseded_by: null,
      parent_code: null,
      created_at: '2024-02-01T00:00:00Z',
      updated_at: '2024-02-01T00:00:00Z',
    };
    mockFetch(200, row);

    const { getRecipeByCode } = await import('./recipes');
    const doc = await getRecipeByCode('COF-002');

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/recipes/COF-002`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(doc).not.toBeNull();
    expect(doc!._id).toBe('recipe:COF-002');
    expect(doc!.beanId).toBe('bean-1');
    expect(doc!.isOfficial).toBe(true);
  });

  it('returns null when API returns 404', async () => {
    mockFetch(404, 'not found');
    const { getRecipeByCode } = await import('./recipes');
    const doc = await getRecipeByCode('COF-999');
    expect(doc).toBeNull();
  });

  it('throws ApiError when API returns 500', async () => {
    mockFetch(500, 'internal server error');
    const { getRecipeByCode } = await import('./recipes');
    const { ApiError } = await import('../api');
    await expect(getRecipeByCode('COF-999')).rejects.toBeInstanceOf(ApiError);
    await expect(getRecipeByCode('COF-999')).rejects.toMatchObject({ status: 500 });
  });
});

describe('listRecipesByBean', () => {
  it('calls GET /recipes?beanId=ID and maps rows', async () => {
    const row = {
      id: 'r3',
      code: 'COF-003',
      method: 'v60',
      title: 'Bean Specific',
      version: 1,
      params: null,
      steps: null,
      bean_id: 'bean-42',
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
      created_at: '2024-03-01T00:00:00Z',
      updated_at: '2024-03-01T00:00:00Z',
    };
    mockFetch(200, [row]);

    const { listRecipesByBean } = await import('./recipes');
    const docs = await listRecipesByBean('bean-42');

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/recipes?beanId=bean-42`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].beanId).toBe('bean-42');
  });
});

// ── beans ─────────────────────────────────────────────────────────────────────

describe('listBeans', () => {
  it('calls GET /beans and maps rows to BeanSummary[]', async () => {
    const row = {
      id: 'bean-1',
      name: 'Ethiopia Yirgacheffe',
      roaster: 'Blue Bottle',
      origin: 'Ethiopia',
      process: 'washed',
      roast_level: 'light',
      notes: 'floral',
      recipe_count: 3,
      latest_recipe_at: '2024-01-15T00:00:00Z',
      has_ai: true,
    };
    mockFetch(200, [row]);

    const { listBeans } = await import('./beans');
    const beans = await listBeans();

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/beans`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(beans).toHaveLength(1);
    expect(beans[0].id).toBe('bean-1');
    expect(beans[0].name).toBe('Ethiopia Yirgacheffe');
    expect(beans[0].recipeCount).toBe(3);
    expect(beans[0].hasAi).toBe(true);
    expect(beans[0].roastLevel).toBe('light');
    expect(beans[0].latestRecipeAt).toBe('2024-01-15T00:00:00Z');
  });
});

describe('getBean', () => {
  it('calls GET /beans/:id and maps single row', async () => {
    const row = {
      id: 'bean-2',
      name: 'Colombia Huila',
      roaster: null,
      origin: 'Colombia',
      process: null,
      roast_level: null,
      notes: null,
      recipe_count: 1,
      latest_recipe_at: null,
      has_ai: false,
    };
    mockFetch(200, row);

    const { getBean } = await import('./beans');
    const bean = await getBean('bean-2');

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/beans/bean-2`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(bean).not.toBeNull();
    expect(bean!.id).toBe('bean-2');
    expect(bean!.roaster).toBeUndefined();
    expect(bean!.hasAi).toBe(false);
  });

  it('returns null when API returns 404', async () => {
    mockFetch(404, 'not found');
    const { getBean } = await import('./beans');
    const bean = await getBean('bean-999');
    expect(bean).toBeNull();
  });

  it('throws ApiError when API returns 500', async () => {
    mockFetch(500, 'internal server error');
    const { getBean } = await import('./beans');
    const { ApiError } = await import('../api');
    await expect(getBean('bean-999')).rejects.toBeInstanceOf(ApiError);
    await expect(getBean('bean-999')).rejects.toMatchObject({ status: 500 });
  });
});

// ── grinders ──────────────────────────────────────────────────────────────────

describe('listGrinders', () => {
  it('calls GET /grinders and maps rows to GrinderInfo[]', async () => {
    const row = {
      id: 'grinder-1',
      name: 'Commandante C40',
      um_per_click_est: 35,
      um_per_click_source: 'measured',
      zero_ref: 'burrs touching',
      stepless: false,
      brew_method_ranges: { v60: { from: 20, to: 30 } },
      notes: 'popular hand grinder',
    };
    mockFetch(200, [row]);

    const { listGrinders } = await import('./grinders');
    const grinders = await listGrinders();

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/grinders`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(grinders).toHaveLength(1);
    expect(grinders[0].id).toBe('grinder-1');
    expect(grinders[0].name).toBe('Commandante C40');
    expect(grinders[0].umPerClickEst).toBe(35);
    expect(grinders[0].umPerClickSource).toBe('measured');
    expect(grinders[0].stepless).toBe(false);
    expect(grinders[0].brewMethodRanges).toEqual({ v60: { from: 20, to: 30 } });
  });

  it('handles stepless grinder (no um_per_click_source)', async () => {
    const row = {
      id: 'grinder-2',
      name: 'Titus',
      um_per_click_est: null,
      um_per_click_source: null,
      zero_ref: null,
      stepless: true,
      brew_method_ranges: null,
      notes: null,
    };
    mockFetch(200, [row]);

    const { listGrinders } = await import('./grinders');
    const grinders = await listGrinders();

    expect(grinders[0].stepless).toBe(true);
    expect(grinders[0].umPerClickEst).toBeUndefined();
    expect(grinders[0].umPerClickSource).toBeUndefined();
    expect(grinders[0].brewMethodRanges).toEqual({});
  });
});

// ── drippers ──────────────────────────────────────────────────────────────────

describe('listDrippers', () => {
  it('calls GET /drippers and maps rows to DripperInfo[]', async () => {
    const row = {
      id: 'dripper-1',
      name: 'Hario V60 02',
      class: 'cone',
      geometry: 'cone',
      continuum_position: 5,
      filter_type: 'paper',
      recommended_dose_range: { minG: 15, maxG: 30 },
      size_models: [{ id: '02', name: '02', capacityMl: 360 }],
      notes: 'classic cone dripper',
    };
    mockFetch(200, [row]);

    const { listDrippers } = await import('./drippers');
    const drippers = await listDrippers();

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/drippers`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(drippers).toHaveLength(1);
    expect(drippers[0].id).toBe('dripper-1');
    expect(drippers[0].name).toBe('Hario V60 02');
    expect(drippers[0].class).toBe('cone');
    expect(drippers[0].continuumPosition).toBe(5);
    expect(drippers[0].filterType).toBe('paper');
    expect(drippers[0].recommendedDoseRange).toEqual({ minG: 15, maxG: 30 });
    expect(drippers[0].sizeModels).toHaveLength(1);
  });

  it('handles dripper with no optional fields', async () => {
    const row = {
      id: 'dripper-2',
      name: 'Minimal',
      class: 'flat',
      geometry: null,
      continuum_position: null,
      filter_type: null,
      recommended_dose_range: null,
      size_models: null,
      notes: null,
    };
    mockFetch(200, [row]);

    const { listDrippers } = await import('./drippers');
    const drippers = await listDrippers();

    expect(drippers[0].continuumPosition).toBeUndefined();
    expect(drippers[0].sizeModels).toBeUndefined();
  });
});

// ── feedback ──────────────────────────────────────────────────────────────────

describe('listFeedbackByRecipe', () => {
  it('calls GET /recipes/:code/feedback and maps rows to FeedbackDoc[]', async () => {
    const row = {
      id: 'fb-1',
      recipe_code: 'COF-001',
      bean_id: 'bean-1',
      ratings: { overall: 4 },
      actual: null,
      comment: 'tasty',
      raw_comment: null,
      quick_tags: ['sweet'],
      desired_direction: null,
      next_hint: null,
      source: 'web',
      created_at: '2024-01-10T00:00:00Z',
      updated_at: '2024-01-10T00:00:00Z',
    };
    mockFetch(200, [row]);

    const { listFeedbackByRecipe } = await import('./feedback');
    const docs = await listFeedbackByRecipe('COF-001');

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/recipes/COF-001/feedback`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]._id).toBe('feedback:COF-001:fb-1');
    expect(docs[0].type).toBe('feedback');
    expect(docs[0].recipeCode).toBe('COF-001');
    expect(docs[0].beanId).toBe('bean-1');
    expect(docs[0].comment).toBe('tasty');
    expect(docs[0].quickTags).toEqual(['sweet']);
  });

  it('returns empty array when no feedback', async () => {
    mockFetch(200, []);
    const { listFeedbackByRecipe } = await import('./feedback');
    const docs = await listFeedbackByRecipe('COF-999');
    expect(docs).toHaveLength(0);
  });
});
