import { describe, expect, it } from 'vitest';
import { addFeedback, listFeedbackForRecipe } from './feedback';
import { NotFoundError } from '../errors';
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

describe('addFeedback', () => {
  it('throws NotFoundError when the recipe does not exist', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/recipe:COF-9999': () => ({ status: 404, body: { error: 'not_found' } })
    });
    await expect(
      addFeedback(
        config,
        { recipeCode: 'COF-9999', ratings: { overall: 4 } },
        fetchImpl
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('stores feedback with feedback:<code>: prefix and recipeId set', async () => {
    const captured: { putBody?: Record<string, unknown>; putPath?: string } = {};
    const fetchImpl = makeRouter({
      'GET /coffee/recipe:COF-0001': () => ({
        status: 200,
        body: {
          _id: 'recipe:COF-0001',
          _rev: '1-r',
          type: 'recipe',
          code: 'COF-0001',
          beanId: 'bean:abc',
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
    // Catch-all PUT for any feedback id by adding a wildcard handler.
    const wrappedFetch: typeof fetch = (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const path = decodeURIComponent(u.pathname);
      if (init?.method === 'PUT' && path.startsWith('/coffee/feedback:COF-0001:')) {
        captured.putBody = JSON.parse(init.body as string);
        captured.putPath = path;
        return new Response(
          JSON.stringify({ ok: true, id: path.replace('/coffee/', ''), rev: '1-f' }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }
      return fetchImpl(url, init);
    }) as unknown as typeof fetch;

    const feedback = await addFeedback(
      config,
      { recipeCode: 'COF-0001', ratings: { overall: 5, sweetness: 3 } },
      wrappedFetch
    );

    expect(feedback._id.startsWith('feedback:COF-0001:')).toBe(true);
    expect(feedback.recipeId).toBe('recipe:COF-0001');
    expect(feedback.recipeCode).toBe('COF-0001');
    expect(feedback.beanId).toBe('bean:abc');
    expect(feedback.source).toBe('web');
    expect(feedback.createdAt).toBe(feedback.updatedAt);
    expect(captured.putBody?.recipeId).toBe('recipe:COF-0001');
  });
});

describe('listFeedbackForRecipe', () => {
  it('returns feedback docs from _all_docs rows for the recipe prefix', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/_all_docs': (_init, url) => {
        // Confirm the prefix range targets feedback:COF-0001:
        expect(url.searchParams.get('startkey')).toBe(JSON.stringify('feedback:COF-0001:'));
        expect(url.searchParams.get('endkey')).toBe(JSON.stringify('feedback:COF-0001:￰'));
        expect(url.searchParams.get('include_docs')).toBe('true');
        return {
          status: 200,
          body: {
            total_rows: 2,
            offset: 0,
            rows: [
              { id: 'feedback:COF-0001:a', key: 'feedback:COF-0001:a', value: { rev: '1-a' }, doc: { _id: 'feedback:COF-0001:a', _rev: '1-a', type: 'feedback', recipeCode: 'COF-0001', recipeId: 'recipe:COF-0001', ratings: { overall: 4 }, source: 'web', createdAt: '2026-04-20T00:00:00Z', updatedAt: '2026-04-20T00:00:00Z' } },
              { id: 'feedback:COF-0001:b', key: 'feedback:COF-0001:b', value: { rev: '1-b' }, doc: { _id: 'feedback:COF-0001:b', _rev: '1-b', type: 'feedback', recipeCode: 'COF-0001', recipeId: 'recipe:COF-0001', ratings: { overall: 5 }, source: 'web', createdAt: '2026-04-21T00:00:00Z', updatedAt: '2026-04-21T00:00:00Z' } }
            ]
          }
        };
      }
    });
    const items = await listFeedbackForRecipe(config, 'COF-0001', fetchImpl);
    expect(items.map((f) => f._id)).toEqual([
      'feedback:COF-0001:a',
      'feedback:COF-0001:b'
    ]);
  });
});
