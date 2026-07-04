import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from './db.js';
import { getTasteSignals } from './repositories/recommend.js';
import { setGlobalPreference, getGlobalPreference } from './repositories/preferences.js';

const SEED = randomUUID().replace(/-/g, '').slice(0, 8);
let appUserId: string;
let beanId: string;
let recipeCode: string;

beforeAll(async () => {
  const db = getDb();
  const u = await db.insertInto('app_users').defaultValues().returning('id').executeTakeFirstOrThrow();
  appUserId = u.id;
  const b = await db.insertInto('beans').values({ name: `SigBean ${SEED}`, roast_level_ord: 5, acidity: 1, body: 4, flavor_categories: ['nutty_cocoa', 'sweet'], attrs_source: 'ai_extracted' }).returning('id').executeTakeFirstOrThrow();
  beanId = b.id;
  await db.insertInto('saved_beans').values({ app_user_id: appUserId, bean_id: beanId }).execute();
  const r = await db.insertInto('recipes').values({ method: 'v60', title: `SigRec ${SEED}`, bean_id: beanId, owner_id: null }).returning('code').executeTakeFirstOrThrow();
  recipeCode = r.code;
  await db.insertInto('feedback').values({ recipe_code: recipeCode, bean_id: beanId, ratings: { overall: 5 } }).execute();
});

afterAll(async () => {
  const db = getDb();
  await db.deleteFrom('feedback').where('recipe_code', '=', recipeCode).execute();
  await db.deleteFrom('recipes').where('code', '=', recipeCode).execute();
  await db.deleteFrom('saved_beans').where('app_user_id', '=', appUserId).execute();
  await db.deleteFrom('beans').where('id', '=', beanId).execute();
  await db.deleteFrom('app_users').where('id', '=', appUserId).execute();
  await closeDb();
});

test('getTasteSignals returns saved + high-rated bean attributes', async () => {
  const s = await getTasteSignals(getDb(), appUserId);
  expect(s.savedBeanAttrs.some((a) => a.acidity === 1 && a.roastLevelOrd === 5)).toBe(true);
  expect(s.ratedBeanAttrs.some((a) => a.flavorCategories?.includes('nutty_cocoa'))).toBe(true);
});

test('getTasteSignals with no user returns empty', async () => {
  const s = await getTasteSignals(getDb(), undefined);
  expect(s.savedBeanAttrs).toEqual([]);
  expect(s.ratedBeanAttrs).toEqual([]);
});

test('setGlobalPreference upserts likes/dislikes', async () => {
  const prev = await getGlobalPreference(getDb());
  await setGlobalPreference(getDb(), { likes: ['저산미', '다크 로스팅'], dislikes: ['고산미'] });
  const row = await getGlobalPreference(getDb());
  expect(row?.likes).toEqual(['저산미', '다크 로스팅']);
  expect(row?.dislikes).toEqual(['고산미']);
  // restore
  await setGlobalPreference(getDb(), { likes: prev?.likes ?? [], dislikes: prev?.dislikes ?? [] });
});
