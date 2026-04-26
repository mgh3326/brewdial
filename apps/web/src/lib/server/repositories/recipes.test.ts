import { describe, expect, it } from 'vitest';
import {
  createRecipe,
  getRecipeByCode,
  listRecentRecipes
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
