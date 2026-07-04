import { Hono } from 'hono';
import { afterAll, expect, test } from 'vitest';
import { getDb, closeDb, getGlobalPreference, setGlobalPreference } from '@brewdial/db';
import { me } from './me.js';
import { identityMiddleware } from '../middleware/identity.js';

function makeApp() { const app = new Hono(); app.use('/api/*', identityMiddleware); app.route('/api/me', me); return app; }
const app = makeApp();

afterAll(async () => { await closeDb(); });

test('PUT /api/me/preferences with whitelisted tags → 200, persisted', async () => {
  const prev = await getGlobalPreference(getDb());
  const res = await app.request('http://localhost/api/me/preferences', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ likes: ['저산미', '다크 로스팅'], dislikes: ['고산미'] }),
  });
  try {
    expect(res.status).toBe(200);
    const row = await getGlobalPreference(getDb());
    expect(row?.likes).toEqual(['저산미', '다크 로스팅']);
    expect(row?.dislikes).toEqual(['고산미']);
  } finally {
    await setGlobalPreference(getDb(), { likes: prev?.likes ?? [], dislikes: prev?.dislikes ?? [] });
  }
});

test('PUT /api/me/preferences with unknown tag → 400', async () => {
  const res = await app.request('http://localhost/api/me/preferences', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ likes: ['초코비'] }),
  });
  expect(res.status).toBe(400);
});
