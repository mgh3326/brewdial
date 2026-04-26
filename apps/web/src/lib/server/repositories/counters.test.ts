import { describe, expect, it } from 'vitest';
import { nextRecipeCode } from './counters';
import type { CouchConfig } from '../config';

const config: CouchConfig = { url: 'http://127.0.0.1:5984', database: 'coffee' };

interface FakeStore {
  doc?: { _id: string; _rev?: string; type: 'counter'; next: number; createdAt: string; updatedAt: string };
  rev: number;
}

function makeFetch(store: FakeStore, opts: { putConflictsRemaining?: number } = {}): typeof fetch {
  let putConflictsRemaining = opts.putConflictsRemaining ?? 0;
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname; // /coffee/counter:recipe (id is encoded)
    const isCounterDoc = decodeURIComponent(path) === '/coffee/counter:recipe';
    const method = init?.method ?? 'GET';

    if (isCounterDoc && method === 'GET') {
      if (!store.doc) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(store.doc), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (isCounterDoc && method === 'PUT') {
      if (putConflictsRemaining > 0) {
        putConflictsRemaining -= 1;
        // Simulate someone else racing the write: bump store.doc to a newer rev.
        if (store.doc) {
          store.rev += 1;
          store.doc = { ...store.doc, _rev: `${store.rev}-x`, next: store.doc.next + 1 };
        } else {
          // Rare: created concurrently
          store.rev += 1;
          store.doc = {
            _id: 'counter:recipe',
            _rev: `${store.rev}-x`,
            type: 'counter',
            next: 2,
            createdAt: 'now',
            updatedAt: 'now'
          };
        }
        return new Response(JSON.stringify({ error: 'conflict' }), {
          status: 409,
          headers: { 'content-type': 'application/json' }
        });
      }
      const body = JSON.parse(init!.body as string) as FakeStore['doc'];
      store.rev += 1;
      store.doc = { ...body!, _rev: `${store.rev}-x` };
      return new Response(
        JSON.stringify({ ok: true, id: store.doc!._id, rev: store.doc!._rev }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response('not handled', { status: 500 });
  }) as unknown as typeof fetch;
}

describe('nextRecipeCode', () => {
  it('creates the counter and returns COF-0001 the first time', async () => {
    const store: FakeStore = { rev: 0 };
    const code = await nextRecipeCode(config, makeFetch(store));
    expect(code).toBe('COF-0001');
    expect(store.doc?.next).toBe(2);
  });

  it('returns COF-0002 when next is 2', async () => {
    const store: FakeStore = {
      rev: 1,
      doc: {
        _id: 'counter:recipe',
        _rev: '1-x',
        type: 'counter',
        next: 2,
        createdAt: 'now',
        updatedAt: 'now'
      }
    };
    const code = await nextRecipeCode(config, makeFetch(store));
    expect(code).toBe('COF-0002');
    expect(store.doc?.next).toBe(3);
  });

  it('retries on _rev conflict and ultimately succeeds', async () => {
    const store: FakeStore = {
      rev: 1,
      doc: {
        _id: 'counter:recipe',
        _rev: '1-x',
        type: 'counter',
        next: 5,
        createdAt: 'now',
        updatedAt: 'now'
      }
    };
    const code = await nextRecipeCode(config, makeFetch(store, { putConflictsRemaining: 1 }));
    // After 1 conflict bumped next to 6, the retry sees next=6 and returns COF-0006.
    expect(code).toBe('COF-0006');
    expect(store.doc?.next).toBe(7);
  });
});
