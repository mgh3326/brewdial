import { describe, expect, it } from 'vitest';
import {
  createRecipe,
  getRecipeByCode,
  listRecentRecipes,
  listRecipesPage
} from './recipes';
import type { CouchConfig } from '../config';

const config: CouchConfig = { url: 'http://127.0.0.1:5984', database: 'coffee' };

interface RouteResult {
  status: number;
  body: unknown;
}

type RouteHandler = (init: RequestInit | undefined, url: URL) => RouteResult;

function makeRouter(routes: Record<string, RouteHandler>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const key = `${init?.method ?? 'GET'} ${decodeURIComponent(u.pathname)}`;
    const handler = routes[key];
    if (!handler) {
      return new Response(`unhandled ${key}`, { status: 500 });
    }
    const result = handler(init, u);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' }
    });
  }) as unknown as typeof fetch;
}

describe('createRecipe', () => {
  it('mints COF-0001, stores recipe:COF-0001, and returns the doc with _rev', async () => {
    const calls: { putBody?: Record<string, unknown> } = {};
    const fetchImpl = makeRouter({
      'GET /coffee/counter:recipe': () => ({ status: 404, body: { error: 'not_found' } }),
      'PUT /coffee/counter:recipe': () => ({
        status: 201,
        body: { ok: true, id: 'counter:recipe', rev: '1-c' }
      }),
      'PUT /coffee/recipe:COF-0001': (init) => {
        calls.putBody = JSON.parse(init!.body as string);
        return {
          status: 201,
          body: { ok: true, id: 'recipe:COF-0001', rev: '1-r' }
        };
      }
    });

    const recipe = await createRecipe(
      config,
      { method: 'v60', title: 'Test V60' },
      fetchImpl
    );

    expect(recipe._id).toBe('recipe:COF-0001');
    expect(recipe.code).toBe('COF-0001');
    expect(recipe._rev).toBe('1-r');
    expect(recipe.version).toBe(1);
    expect(recipe.params).toEqual({});
    expect(recipe.steps).toEqual([]);
    expect(recipe.createdBy).toBe('manual');
    expect(recipe.createdAt).toBe(recipe.updatedAt);
    expect(calls.putBody?.title).toBe('Test V60');
  });
});

describe('getRecipeByCode', () => {
  it('returns the doc when CouchDB returns 200', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/recipe:COF-0001': () => ({
        status: 200,
        body: {
          _id: 'recipe:COF-0001',
          _rev: '1-r',
          type: 'recipe',
          code: 'COF-0001',
          method: 'v60',
          version: 1,
          title: 'X',
          params: {},
          steps: [],
          createdBy: 'manual',
          createdAt: 'now',
          updatedAt: 'now'
        }
      })
    });
    const recipe = await getRecipeByCode(config, 'COF-0001', fetchImpl);
    expect(recipe?._id).toBe('recipe:COF-0001');
  });

  it('returns null on 404', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/recipe:COF-9999': () => ({ status: 404, body: { error: 'not_found' } })
    });
    const recipe = await getRecipeByCode(config, 'COF-9999', fetchImpl);
    expect(recipe).toBeNull();
  });
});

describe('listRecentRecipes', () => {
  it('returns recipe docs from _all_docs rows, newest first by createdAt, capped by limit', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/_all_docs': () => ({
        status: 200,
        body: {
          total_rows: 3,
          offset: 0,
          rows: [
            { id: 'recipe:COF-0001', key: 'recipe:COF-0001', value: { rev: '1-a' }, doc: { _id: 'recipe:COF-0001', _rev: '1-a', type: 'recipe', code: 'COF-0001', method: 'v60', version: 1, title: 'A', params: {}, steps: [], createdBy: 'manual', createdAt: '2026-04-20T00:00:00Z', updatedAt: '2026-04-20T00:00:00Z' } },
            { id: 'recipe:COF-0002', key: 'recipe:COF-0002', value: { rev: '1-b' }, doc: { _id: 'recipe:COF-0002', _rev: '1-b', type: 'recipe', code: 'COF-0002', method: 'v60', version: 1, title: 'B', params: {}, steps: [], createdBy: 'manual', createdAt: '2026-04-22T00:00:00Z', updatedAt: '2026-04-22T00:00:00Z' } },
            { id: 'recipe:COF-0003', key: 'recipe:COF-0003', value: { rev: '1-c' }, doc: { _id: 'recipe:COF-0003', _rev: '1-c', type: 'recipe', code: 'COF-0003', method: 'v60', version: 1, title: 'C', params: {}, steps: [], createdBy: 'manual', createdAt: '2026-04-21T00:00:00Z', updatedAt: '2026-04-21T00:00:00Z' } }
          ]
        }
      })
    });
    const recipes = await listRecentRecipes(config, 2, fetchImpl);
    expect(recipes).toHaveLength(2);
    expect(recipes[0].code).toBe('COF-0002'); // newest createdAt
    expect(recipes[1].code).toBe('COF-0003');
  });
});

function recipeRow(code: string, createdAt: string) {
  return {
    id: `recipe:${code}`,
    key: `recipe:${code}`,
    value: { rev: '1-x' },
    doc: {
      _id: `recipe:${code}`,
      _rev: '1-x',
      type: 'recipe',
      code,
      method: 'v60',
      version: 1,
      title: code,
      params: {},
      steps: [],
      createdBy: 'manual',
      createdAt,
      updatedAt: createdAt
    }
  };
}

function makeAllDocsRouter(rows: ReturnType<typeof recipeRow>[]): typeof fetch {
  return makeRouter({
    'GET /coffee/_all_docs': () => ({
      status: 200,
      body: { total_rows: rows.length, offset: 0, rows }
    })
  });
}

describe('listRecipesPage', () => {
  // createdAt desc order: COF-0005, COF-0004, COF-0003, COF-0002, COF-0001
  const rows = [
    recipeRow('COF-0001', '2026-04-01T00:00:00Z'),
    recipeRow('COF-0002', '2026-04-02T00:00:00Z'),
    recipeRow('COF-0003', '2026-04-03T00:00:00Z'),
    recipeRow('COF-0004', '2026-04-04T00:00:00Z'),
    recipeRow('COF-0005', '2026-04-05T00:00:00Z')
  ];

  it('returns the first page newest-first with paging metadata', async () => {
    const result = await listRecipesPage(config, { page: 1, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(result.recipes.map((r) => r.code)).toEqual(['COF-0005', 'COF-0004']);
    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.totalPages).toBe(3);
  });

  it('returns the last partial page', async () => {
    const result = await listRecipesPage(config, { page: 3, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(result.recipes.map((r) => r.code)).toEqual(['COF-0001']);
    expect(result.page).toBe(3);
  });

  it('clamps an out-of-range page to the last page', async () => {
    const result = await listRecipesPage(config, { page: 99, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(result.page).toBe(3);
    expect(result.recipes.map((r) => r.code)).toEqual(['COF-0001']);
  });

  it('clamps page below 1 and non-finite to page 1', async () => {
    const zero = await listRecipesPage(config, { page: 0, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(zero.page).toBe(1);
    const nan = await listRecipesPage(config, { page: Number.NaN, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(nan.page).toBe(1);
  });

  it('handles an empty dataset', async () => {
    const result = await listRecipesPage(config, { page: 1, pageSize: 2 }, makeAllDocsRouter([]));
    expect(result.recipes).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
  });

  it('never duplicates or skips a card across consecutive pages', async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const r = await listRecipesPage(config, { page, pageSize: 2 }, makeAllDocsRouter(rows));
      seen.push(...r.recipes.map((x) => x.code));
    }
    expect(seen).toEqual(['COF-0005', 'COF-0004', 'COF-0003', 'COF-0002', 'COF-0001']);
    expect(new Set(seen).size).toBe(5);
  });
});
