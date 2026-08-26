import { request } from '../test/request.js'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'


// Unique seed IDs / codes so tests are re-run safe.
const SEED_SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)
const beanId = randomUUID()

// We rely on the `code` column's DEFAULT (sequence), but for deterministic test assertions
// we insert explicit codes using a test-unique suffix.
const activeCode1 = `T-ACTIVE1-${SEED_SUFFIX}`
const activeCode2 = `T-ACTIVE2-${SEED_SUFFIX}`
const testCode = `T-TEST-${SEED_SUFFIX}`
const supersededCode = `T-SUPER-${SEED_SUFFIX}`
const beanRecipeCode = `T-BEAN-${SEED_SUFFIX}`
const feedbackId = randomUUID()

beforeAll(async () => {
  const db = getDb()

  // Insert a bean that the bean-linked recipe references.
  await db.insertInto('beans').values({ id: beanId, name: `Test Bean ${SEED_SUFFIX}` }).execute()

  // Seed recipes with various statuses.
  await db.insertInto('recipes').values([
    {
      code: activeCode1,
      method: 'v60',
      title: 'Active Recipe 1',
      status: 'active',
      owner_id: null,
    },
    {
      code: activeCode2,
      method: 'v60',
      title: 'Active Recipe 2',
      status: 'active',
      owner_id: null,
    },
    {
      code: testCode,
      method: 'v60',
      title: 'Test-status Recipe',
      status: 'test',
      owner_id: null,
    },
    {
      code: supersededCode,
      method: 'v60',
      title: 'Superseded Recipe',
      status: 'superseded',
      owner_id: null,
    },
    {
      code: beanRecipeCode,
      method: 'v60',
      title: 'Bean Recipe',
      status: 'active',
      bean_id: beanId,
      owner_id: null,
    },
  ]).execute()

  // Seed feedback for activeCode1. `source` defaults to 'web' (check: web|coffee_profile|api|agent|mcp).
  await db.insertInto('feedback').values({
    id: feedbackId,
    recipe_code: activeCode1,
    source: 'web',
  }).execute()
})

afterAll(async () => {
  const db = getDb()
  await db.deleteFrom('feedback').where('id', '=', feedbackId).execute()
  await db.deleteFrom('recipes')
    .where('code', 'in', [activeCode1, activeCode2, testCode, supersededCode, beanRecipeCode])
    .execute()
  await db.deleteFrom('beans').where('id', '=', beanId).execute()
  await closeDb()
})

// ─── GET /api/recipes ────────────────────────────────────────────────────────

test('GET /api/recipes returns only active recipes', async () => {
  const res = await request('/api/recipes')
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)

  const codes = rows.map((r) => r['code'])
  // Active seeds must appear.
  expect(codes).toContain(activeCode1)
  expect(codes).toContain(activeCode2)
  expect(codes).toContain(beanRecipeCode)
  // Non-active seeds must NOT appear.
  expect(codes).not.toContain(testCode)
  expect(codes).not.toContain(supersededCode)
})

test('GET /api/recipes returns rows newest-first', async () => {
  const res = await request('/api/recipes')
  const rows: Array<Record<string, unknown>> = await res.json()
  // Verify order: each row's created_at >= the next row's created_at.
  for (let i = 0; i < rows.length - 1; i++) {
    const a = new Date(rows[i]['created_at'] as string).getTime()
    const b = new Date(rows[i + 1]['created_at'] as string).getTime()
    expect(a).toBeGreaterThanOrEqual(b)
  }
})

test('GET /api/recipes respects ?limit=', async () => {
  const res = await request('/api/recipes?limit=1')
  expect(res.status).toBe(200)
  const rows: Array<unknown> = await res.json()
  expect(rows.length).toBe(1)
})

test('GET /api/recipes rows contain expected snake_case keys', async () => {
  const res = await request('/api/recipes')
  const rows: Array<Record<string, unknown>> = await res.json()
  const row = rows.find((r) => r['code'] === activeCode1)
  expect(row).toBeTruthy()
  // Spot-check key columns the client mapper consumes.
  expect(row).toHaveProperty('id')
  expect(row).toHaveProperty('code')
  expect(row).toHaveProperty('method')
  expect(row).toHaveProperty('title')
  expect(row).toHaveProperty('created_by')
  expect(row).toHaveProperty('is_official')
  expect(row).toHaveProperty('bean_id')
  expect(row).toHaveProperty('status')
  expect(row).toHaveProperty('created_at')
  expect(row).toHaveProperty('updated_at')
})

// ─── GET /api/recipes?beanId= ─────────────────────────────────────────────────

test('GET /api/recipes?beanId= filters by bean + active only', async () => {
  const res = await request(`/api/recipes?beanId=${beanId}`)
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  // Only the bean recipe should be returned.
  expect(rows.length).toBeGreaterThanOrEqual(1)
  for (const row of rows) {
    expect(row['bean_id']).toBe(beanId)
    expect(row['status']).toBe('active')
  }
  const codes = rows.map((r) => r['code'])
  expect(codes).toContain(beanRecipeCode)
})

test('GET /api/recipes?beanId= returns empty array for unknown bean', async () => {
  const res = await request(`/api/recipes?beanId=${randomUUID()}`)
  expect(res.status).toBe(200)
  const rows: Array<unknown> = await res.json()
  expect(rows).toEqual([])
})

// ─── GET /api/recipes/:code ───────────────────────────────────────────────────

test('GET /api/recipes/:code returns the recipe row', async () => {
  const res = await request(`/api/recipes/${activeCode1}`)
  expect(res.status).toBe(200)
  const row: Record<string, unknown> = await res.json()
  expect(row['code']).toBe(activeCode1)
  expect(row['status']).toBe('active')
})

test('GET /api/recipes/:code 404 for test-status recipe', async () => {
  const res = await request(`/api/recipes/${testCode}`)
  expect(res.status).toBe(404)
})

test('GET /api/recipes/:code 404 for non-existent code', async () => {
  const res = await request(`/api/recipes/DOES-NOT-EXIST-${SEED_SUFFIX}`)
  expect(res.status).toBe(404)
})

test('GET /api/recipes/:code returns superseded recipe (not filtered out)', async () => {
  // Only test-status is excluded; superseded should still be accessible by code.
  const res = await request(`/api/recipes/${supersededCode}`)
  expect(res.status).toBe(200)
  const row: Record<string, unknown> = await res.json()
  expect(row['code']).toBe(supersededCode)
  expect(row['status']).toBe('superseded')
})

// ─── GET /api/recipes/:code/feedback ─────────────────────────────────────────

test('GET /api/recipes/:code/feedback returns seeded feedback', async () => {
  const res = await request(`/api/recipes/${activeCode1}/feedback`)
  expect(res.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await res.json()
  expect(Array.isArray(rows)).toBe(true)
  const fb = rows.find((r) => r['id'] === feedbackId)
  expect(fb).toBeTruthy()
  expect(fb!['recipe_code']).toBe(activeCode1)
})

test('GET /api/recipes/:code/feedback contains expected snake_case keys', async () => {
  const res = await request(`/api/recipes/${activeCode1}/feedback`)
  const rows: Array<Record<string, unknown>> = await res.json()
  const fb = rows.find((r) => r['id'] === feedbackId)
  expect(fb).toBeTruthy()
  expect(fb).toHaveProperty('id')
  expect(fb).toHaveProperty('recipe_code')
  expect(fb).toHaveProperty('bean_id')
  expect(fb).toHaveProperty('source')
  expect(fb).toHaveProperty('created_at')
  expect(fb).toHaveProperty('updated_at')
})

test('GET /api/recipes/:code/feedback returns empty array for no feedback', async () => {
  const res = await request(`/api/recipes/${activeCode2}/feedback`)
  expect(res.status).toBe(200)
  const rows: Array<unknown> = await res.json()
  expect(rows).toEqual([])
})
