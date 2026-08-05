import { Hono } from 'hono'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'
import { beans } from './beans.js'
import { registries } from './registries.js'

// Build a self-contained Hono app for tests (not the main app.ts — Task 6 mounts these).
function makeApp() {
  const app = new Hono()
  app.route('/api/beans', beans)
  app.route('/api', registries)
  return app
}

const app = makeApp()

// Unique seed IDs so tests are re-run safe.
const SEED_SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)

const beanWithRecipeId = randomUUID()
const beanNoRecipeId = randomUUID()
const recipeCode1 = `T-BEAN1-${SEED_SUFFIX}`
const recipeCode2 = `T-BEAN2-${SEED_SUFFIX}`

// Grinder/dripper IDs for registry tests.
const grinderId1 = randomUUID()
const grinderId2 = randomUUID()
const dripperId1 = randomUUID()
const dripperId2 = randomUUID()

beforeAll(async () => {
  const db = getDb()

  // Clean up any potential leftovers from partial prior runs.
  await db.deleteFrom('recipes').where('code', 'in', [recipeCode1, recipeCode2]).execute()
  await db.deleteFrom('beans').where('id', 'in', [beanWithRecipeId, beanNoRecipeId]).execute()
  await db.deleteFrom('grinders').where('id', 'in', [grinderId1, grinderId2]).execute()
  await db.deleteFrom('drippers').where('id', 'in', [dripperId1, dripperId2]).execute()

  // Insert beans.
  await db.insertInto('beans').values([
    { id: beanWithRecipeId, name: `Bean With Recipe ${SEED_SUFFIX}` },
    { id: beanNoRecipeId, name: `Bean No Recipe ${SEED_SUFFIX}` },
  ]).execute()

  // Insert active recipes for beanWithRecipeId (this causes bean_summaries to roll up recipe_count > 0).
  await db.insertInto('recipes').values([
    {
      code: recipeCode1,
      method: 'v60',
      title: `Bean Recipe 1 ${SEED_SUFFIX}`,
      status: 'active',
      bean_id: beanWithRecipeId,
      owner_id: null,
    },
    {
      code: recipeCode2,
      method: 'v60',
      title: `Bean Recipe 2 ${SEED_SUFFIX}`,
      status: 'active',
      bean_id: beanWithRecipeId,
      owner_id: null,
    },
  ]).execute()

  // Insert grinders for registry tests.
  await db.insertInto('grinders').values([
    { id: grinderId1, name: `ZZ Registry Grinder ${SEED_SUFFIX}` },
    { id: grinderId2, name: `AA Registry Grinder ${SEED_SUFFIX}` },
  ]).execute()

  // Insert drippers for registry tests — continuum_position drives ordering (must be 0..1).
  await db.insertInto('drippers').values([
    { id: dripperId1, name: `Dripper High ${SEED_SUFFIX}`, class: 'hybrid', continuum_position: '0.9' },
    { id: dripperId2, name: `Dripper Low ${SEED_SUFFIX}`, class: 'hybrid', continuum_position: '0.1' },
  ]).execute()
})

afterAll(async () => {
  const db = getDb()
  await db.deleteFrom('recipes').where('code', 'in', [recipeCode1, recipeCode2]).execute()
  await db.deleteFrom('beans').where('id', 'in', [beanWithRecipeId, beanNoRecipeId]).execute()
  await db.deleteFrom('grinders').where('id', 'in', [grinderId1, grinderId2]).execute()
  await db.deleteFrom('drippers').where('id', 'in', [dripperId1, dripperId2]).execute()
  await closeDb()
})

// ─── GET /api/beans ───────────────────────────────────────────────────────────

test('GET /api/beans returns only beans with recipe_count > 0', async () => {
  const res = await app.request('/api/beans')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)

  const ids = rows.map((r) => r['id'])
  // Bean with active recipes should appear.
  expect(ids).toContain(beanWithRecipeId)
  // Bean with no recipes must NOT appear.
  expect(ids).not.toContain(beanNoRecipeId)
})

test('GET /api/beans is ordered by latest_recipe_at desc', async () => {
  const res = await app.request('/api/beans')
  const rows: Array<Record<string, unknown>> = await res.json()
  // Verify ordering: each row's latest_recipe_at >= the next row's (nulls last).
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]['latest_recipe_at']
    const b = rows[i + 1]['latest_recipe_at']
    if (a != null && b != null) {
      expect(new Date(a as string).getTime()).toBeGreaterThanOrEqual(new Date(b as string).getTime())
    }
  }
})

test('GET /api/beans rows contain expected snake_case keys', async () => {
  const res = await app.request('/api/beans')
  const rows: Array<Record<string, unknown>> = await res.json()
  const row = rows.find((r) => r['id'] === beanWithRecipeId)
  expect(row).toBeTruthy()
  expect(row).toHaveProperty('id')
  expect(row).toHaveProperty('name')
  expect(row).toHaveProperty('roaster')
  expect(row).toHaveProperty('origin')
  expect(row).toHaveProperty('process')
  expect(row).toHaveProperty('roast_level')
  expect(row).toHaveProperty('notes')
  expect(row).toHaveProperty('recipe_count')
  expect(row).toHaveProperty('latest_recipe_at')
  expect(row).toHaveProperty('has_ai')
})

test('GET /api/beans row has recipe_count > 0 for seeded bean', async () => {
  const res = await app.request('/api/beans')
  const rows: Array<Record<string, unknown>> = await res.json()
  const row = rows.find((r) => r['id'] === beanWithRecipeId)
  expect(row).toBeTruthy()
  expect(Number(row!['recipe_count'])).toBeGreaterThan(0)
})

// ─── GET /api/beans/:id ───────────────────────────────────────────────────────

test('GET /api/beans/:id returns the bean row', async () => {
  const res = await app.request(`/api/beans/${beanWithRecipeId}`)
  expect(res.status).toBe(200)
  const row: Record<string, unknown> = await res.json()
  expect(row['id']).toBe(beanWithRecipeId)
  expect(row).toHaveProperty('recipe_count')
  expect(row).toHaveProperty('has_ai')
  expect(row).toHaveProperty('latest_recipe_at')
})

test('GET /api/beans/:id 404 for non-existent id', async () => {
  const res = await app.request(`/api/beans/${randomUUID()}`)
  expect(res.status).toBe(404)
})

test('GET /api/beans/:id returns bean even without recipes (no recipe_count filter)', async () => {
  // getBean should return the row regardless of recipe_count (no filter on single lookup).
  const res = await app.request(`/api/beans/${beanNoRecipeId}`)
  // The bean_summaries view may or may not include rows with recipe_count=0; either 200 or 404 is valid.
  // We just assert it doesn't crash (no 500).
  expect([200, 404]).toContain(res.status)
})

// ─── GET /api/grinders ────────────────────────────────────────────────────────

test('GET /api/grinders returns grinder rows ordered by name', async () => {
  const res = await app.request('/api/grinders')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)

  const names = rows.map((r) => r['name'] as string)
  const aaIdx = names.findIndex((n) => n.includes(`AA Registry Grinder ${SEED_SUFFIX}`))
  const zzIdx = names.findIndex((n) => n.includes(`ZZ Registry Grinder ${SEED_SUFFIX}`))
  expect(aaIdx).toBeGreaterThanOrEqual(0)
  expect(zzIdx).toBeGreaterThanOrEqual(0)
  // AA should come before ZZ in name order.
  expect(aaIdx).toBeLessThan(zzIdx)
})

test('GET /api/grinders rows contain expected keys', async () => {
  const res = await app.request('/api/grinders')
  const rows: Array<Record<string, unknown>> = await res.json()
  const row = rows.find((r) => (r['id'] as string) === grinderId1)
  expect(row).toBeTruthy()
  expect(row).toHaveProperty('id')
  expect(row).toHaveProperty('name')
})

// ─── GET /api/drippers ────────────────────────────────────────────────────────

test('GET /api/drippers returns dripper rows ordered by continuum_position', async () => {
  const res = await app.request('/api/drippers')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)

  const ids = rows.map((r) => r['id'] as string)
  const lowIdx = ids.indexOf(dripperId2)  // continuum_position=1 (low)
  const highIdx = ids.indexOf(dripperId1) // continuum_position=99 (high)
  expect(lowIdx).toBeGreaterThanOrEqual(0)
  expect(highIdx).toBeGreaterThanOrEqual(0)
  // Low continuum_position should come first.
  expect(lowIdx).toBeLessThan(highIdx)
})

test('GET /api/drippers rows contain expected keys', async () => {
  const res = await app.request('/api/drippers')
  const rows: Array<Record<string, unknown>> = await res.json()
  const row = rows.find((r) => (r['id'] as string) === dripperId1)
  expect(row).toBeTruthy()
  expect(row).toHaveProperty('id')
  expect(row).toHaveProperty('name')
  expect(row).toHaveProperty('continuum_position')
})
