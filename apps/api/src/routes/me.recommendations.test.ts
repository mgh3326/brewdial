import { request } from '../test/request.js'
import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb, getGlobalPreference, setGlobalPreference } from '@brewdial/db';

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
  const res = await request('/api/me/recommendations');
  expect(res.status).toBe(200);
  const body: any = await res.json();
  expect(body.tasteProfile).toBeDefined();
  expect(typeof body.tasteProfile.confidence).toBe('string');
  expect(body.bands[beanId]).toBeDefined();
  expect(['great', 'ok', 'adventure', 'unknown']).toContain(body.bands[beanId].band);
  expect(Array.isArray(body.ranked)).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/%/);
});

test('GET /api/me/recommendations with a non-empty taste target → no decimals leak into the response', async () => {
  // Non-empty global tags → confidence != 'none' → scoreBean produces fractional
  // internal scores. The internal `score` float must NOT reach the client.
  const prev = await getGlobalPreference(getDb());
  await setGlobalPreference(getDb(), {
    likes: ['저산미', '다크 로스팅', '고소함', '초콜릿/단맛'],
    dislikes: ['고산미'],
  });
  try {
    const res = await request('/api/me/recommendations');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tasteProfile.confidence).not.toBe('none');
    expect(body.tasteProfile.likes).toEqual(expect.arrayContaining(['저산미', '다크 로스팅']));
    expect(['great', 'ok', 'adventure', 'unknown']).toContain(body.bands[beanId].band);
    // No decimal number anywhere in the payload (catches the internal score float leak).
    expect(JSON.stringify(body)).not.toMatch(/\d\.\d/);
    expect(JSON.stringify(body)).not.toMatch(/%/);
    // The band object must not expose the internal `score` field.
    expect(body.bands[beanId].score).toBeUndefined();
  } finally {
    await setGlobalPreference(getDb(), { likes: prev?.likes ?? [], dislikes: prev?.dislikes ?? [] });
  }
});
