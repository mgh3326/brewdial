import { Hono } from 'hono';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from '@brewdial/db';
import { me } from './me.js';
import { identityMiddleware } from '../middleware/identity.js';

function makeApp() { const app = new Hono(); app.use('/api/*', identityMiddleware); app.route('/api/me', me); return app; }
const app = makeApp();
const SEED = randomUUID().replace(/-/g, '').slice(0, 8);
let beanId: string;

beforeAll(async () => {
  const db = getDb();
  const b = await db.insertInto('beans').values({ name: `RecBean ${SEED}`, roast_level_ord: 5, acidity: 1, body: 4, flavor_categories: ['nutty_cocoa', 'sweet'], attrs_source: 'ai_extracted' }).returning('id').executeTakeFirstOrThrow();
  beanId = b.id;
  // give it an active public recipe so it appears in listBeans (recipe_count>0)
  await db.insertInto('recipes').values({ method: 'v60', title: `RecBean rec ${SEED}`, bean_id: beanId, owner_id: null }).execute();
});
afterAll(async () => {
  const db = getDb();
  await db.deleteFrom('recipes').where('title', 'like', `RecBean rec ${SEED}`).execute();
  await db.deleteFrom('beans').where('id', '=', beanId).execute();
  await closeDb();
});

test('GET /api/me/recommendations without identity → 200 with tasteProfile + bands', async () => {
  const res = await app.request('http://localhost/api/me/recommendations');
  expect(res.status).toBe(200);
  const body: any = await res.json();
  expect(body.tasteProfile).toBeDefined();
  expect(typeof body.tasteProfile.confidence).toBe('string');
  expect(body.bands[beanId]).toBeDefined();
  expect(['great', 'ok', 'adventure', 'unknown']).toContain(body.bands[beanId].band);
  expect(Array.isArray(body.ranked)).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/%/);
});
