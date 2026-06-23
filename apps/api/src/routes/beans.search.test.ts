import { Hono } from 'hono'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'
import { beans } from './beans.js'

function makeApp() {
  const app = new Hono()
  app.route('/api/beans', beans)
  return app
}

const app = makeApp()

// Unique suffix so re-runs don't collide.
const SEED_SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)

// Two beans that WILL have recipes (recipe_count > 0).
const beanEthiopiaId = randomUUID()
const beanBrazilId = randomUUID()
// One bean with NO recipes (recipe_count = 0) — must be excluded from search.
const beanNoRecipeId = randomUUID()

const recipeCode1 = `T-BSEARCH1-${SEED_SUFFIX}`
const recipeCode2 = `T-BSEARCH2-${SEED_SUFFIX}`
// Brazil gets a second recipe so it has recipe_count=2 (> Ethiopia's 1) — for ordering test.
const recipeCode3 = `T-BSEARCH3-${SEED_SUFFIX}`

beforeAll(async () => {
  const db = getDb()

  // Clean up potential leftovers.
  await db.deleteFrom('recipes').where('code', 'in', [recipeCode1, recipeCode2, recipeCode3]).execute()
  await db.deleteFrom('beans').where('id', 'in', [beanEthiopiaId, beanBrazilId, beanNoRecipeId]).execute()

  // Seed beans.
  await db.insertInto('beans').values([
    { id: beanEthiopiaId, name: `Ethiopia Yirgacheffe ${SEED_SUFFIX}`, roaster: `Acme Roasters ${SEED_SUFFIX}` },
    { id: beanBrazilId,   name: `Brazil Cerrado ${SEED_SUFFIX}`,        roaster: `Blue Bottle ${SEED_SUFFIX}` },
    { id: beanNoRecipeId, name: `NoRecipe Bean ${SEED_SUFFIX}`,          roaster: `Acme Roasters ${SEED_SUFFIX}` },
  ]).execute()

  // Seed active recipes: beanBrazilId gets 2 recipes (higher recipe_count) vs beanEthiopiaId 1 recipe.
  await db.insertInto('recipes').values([
    {
      code: recipeCode1,
      method: 'v60',
      title: `Ethiopia Recipe ${SEED_SUFFIX}`,
      status: 'active',
      bean_id: beanEthiopiaId,
      owner_id: null,
    },
    {
      code: recipeCode2,
      method: 'v60',
      title: `Brazil Recipe ${SEED_SUFFIX}`,
      status: 'active',
      bean_id: beanBrazilId,
      owner_id: null,
    },
    {
      code: recipeCode3,
      method: 'v60',
      title: `Brazil Recipe 2 ${SEED_SUFFIX}`,
      status: 'active',
      bean_id: beanBrazilId,
      owner_id: null,
    },
  ]).execute()
})

afterAll(async () => {
  const db = getDb()
  await db.deleteFrom('recipes').where('code', 'in', [recipeCode1, recipeCode2, recipeCode3]).execute()
  await db.deleteFrom('beans').where('id', 'in', [beanEthiopiaId, beanBrazilId, beanNoRecipeId]).execute()
  await closeDb()
})

// ─── Search: name ILIKE ───────────────────────────────────────────────────────

test('GET /api/beans?q=ethio returns matching bean by name (case-insensitive)', async () => {
  const res = await app.request('/api/beans?q=ethio')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)
  const ids = rows.map((r) => r['id'])
  expect(ids).toContain(beanEthiopiaId)
})

test('GET /api/beans?q=ETHIOPIA returns matching bean (uppercase query)', async () => {
  const res = await app.request('/api/beans?q=ETHIOPIA')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  const ids = rows.map((r) => r['id'])
  expect(ids).toContain(beanEthiopiaId)
})

// ─── Search: roaster ILIKE ────────────────────────────────────────────────────

test('GET /api/beans?q=acme matches by roaster (case-insensitive)', async () => {
  const res = await app.request('/api/beans?q=acme')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  const ids = rows.map((r) => r['id'])
  // beanEthiopiaId has roaster "Acme Roasters" with a recipe.
  expect(ids).toContain(beanEthiopiaId)
  // beanNoRecipeId also has roaster "Acme Roasters" but recipe_count=0 — must NOT appear.
  expect(ids).not.toContain(beanNoRecipeId)
})

// ─── Search: no match ─────────────────────────────────────────────────────────

test('GET /api/beans?q=zzznomatch returns empty array', async () => {
  const res = await app.request('/api/beans?q=zzznomatch')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)
  expect(rows.length).toBe(0)
})

// ─── recipe_count > 0 filter ──────────────────────────────────────────────────

test('GET /api/beans?q=<roaster> excludes beans with recipe_count=0', async () => {
  // beanNoRecipeId has the same roaster as beanEthiopiaId but no recipes.
  const suffix = SEED_SUFFIX
  const res = await app.request(`/api/beans?q=${encodeURIComponent('Acme Roasters ' + suffix)}`)
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  const ids = rows.map((r) => r['id'])
  // Bean with recipes should appear.
  expect(ids).toContain(beanEthiopiaId)
  // Bean without recipes must NOT appear even though roaster matches.
  expect(ids).not.toContain(beanNoRecipeId)
})

// ─── No q: existing listBeans still works ─────────────────────────────────────

test('GET /api/beans (no q) still returns list including seeded bean with recipes', async () => {
  const res = await app.request('/api/beans')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)
  const ids = rows.map((r) => r['id'])
  expect(ids).toContain(beanEthiopiaId)
  expect(ids).not.toContain(beanNoRecipeId)
})

// ─── Limit clamp ──────────────────────────────────────────────────────────────

test('GET /api/beans?q=a&limit=1 respects limit clamp', async () => {
  const res = await app.request('/api/beans?q=a&limit=1')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)
  // At most 1 row returned.
  expect(rows.length).toBeLessThanOrEqual(1)
})

test('GET /api/beans?q=a&limit=999 clamps to 25', async () => {
  const res = await app.request('/api/beans?q=a&limit=999')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)
  expect(rows.length).toBeLessThanOrEqual(25)
})

// ─── NaN limit floor (Fix 3) ──────────────────────────────────────────────────

test('GET /api/beans?q=a&limit=abc falls back to default (≤10 results, no error)', async () => {
  const res = await app.request('/api/beans?q=a&limit=abc')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)
  // Falls back to default limit=10, no error
  expect(rows.length).toBeLessThanOrEqual(10)
})

// ─── recipe_count DESC ordering (Fix 2) ───────────────────────────────────────

test('GET /api/beans?q=<suffix> returns higher recipe_count bean first', async () => {
  // Brazil (recipe_count=2) should appear before Ethiopia (recipe_count=1).
  const res = await app.request(`/api/beans?q=${encodeURIComponent(SEED_SUFFIX)}`)
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  const ids = rows.map((r) => r['id'])
  const brazilIdx = ids.indexOf(beanBrazilId)
  const ethiopiaIdx = ids.indexOf(beanEthiopiaId)
  // Both must appear.
  expect(brazilIdx).toBeGreaterThanOrEqual(0)
  expect(ethiopiaIdx).toBeGreaterThanOrEqual(0)
  // Brazil (2 recipes) before Ethiopia (1 recipe).
  expect(brazilIdx).toBeLessThan(ethiopiaIdx)
})

// ─── Whitespace trim (Fix 2) ──────────────────────────────────────────────────

test('GET /api/beans?q= ethio  (surrounding whitespace) matches Ethiopia bean', async () => {
  const res = await app.request(`/api/beans?q=${encodeURIComponent(' ethio ')}`)
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  const ids = rows.map((r) => r['id'])
  expect(ids).toContain(beanEthiopiaId)
})
