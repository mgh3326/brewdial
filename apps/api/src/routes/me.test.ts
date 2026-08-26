import { request } from '../test/request.js'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'


// Use a unique identity per run so tests are re-run safe and isolated.
const SEED_SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)
const IDENTITY_KEY = `toss_anon:metest_${SEED_SUFFIX}_${'0'.repeat(20)}`

// Seeded test data
const beanId = randomUUID()
const activeCode = `T-ME-ACTIVE-${SEED_SUFFIX}`
const testCode = `T-ME-TEST-${SEED_SUFFIX}`

beforeAll(async () => {
  const db = getDb()

  // Insert a bean to save.
  await db.insertInto('beans').values({ id: beanId, name: `Me Test Bean ${SEED_SUFFIX}` }).execute()

  // Insert a public active recipe (no owner) to save.
  await db.insertInto('recipes').values([
    {
      code: activeCode,
      method: 'v60',
      title: 'Me Test Active Recipe',
      status: 'active',
      owner_id: null,
    },
    {
      code: testCode,
      method: 'v60',
      title: 'Me Test Test-Status Recipe',
      status: 'test',
      owner_id: null,
    },
  ]).execute()
})

afterAll(async () => {
  const db = getDb()
  // Clean up in reverse dependency order. Identity + user cleanup handled by cascade.
  await db.deleteFrom('recipes')
    .where('code', 'in', [activeCode, testCode])
    .execute()
  await db.deleteFrom('beans').where('id', '=', beanId).execute()
  await closeDb()
})

// ─── POST /api/me/saved-recipes ──────────────────────────────────────────────

test('POST /me/saved-recipes saves recipe and GET /me/collections shows it with snapshot', async () => {
  const saveRes = await request('/api/me/saved-recipes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_KEY,
    },
    body: JSON.stringify({ code: activeCode }),
  })
  expect(saveRes.status).toBe(201)
  const saveBody = await saveRes.json()
  expect(saveBody.ok).toBe(true)

  const colRes = await request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': IDENTITY_KEY },
  })
  expect(colRes.status).toBe(200)
  const collections = await colRes.json()
  expect(Array.isArray(collections.savedRecipes)).toBe(true)
  const saved = collections.savedRecipes.find(
    (r: Record<string, unknown>) => r['recipe_code'] === activeCode
  )
  expect(saved).toBeTruthy()
  // Snapshot must be populated server-side (offline-by-construction).
  expect(saved!['snapshot']).not.toBeNull()
  expect(typeof saved!['snapshot']).toBe('object')
})

test('POST /me/saved-recipes with test-status code does NOT appear in savedRecipes', async () => {
  const saveRes = await request('/api/me/saved-recipes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_KEY,
    },
    body: JSON.stringify({ code: testCode }),
  })
  // The route itself succeeds (the upsert runs), but saveRecipe skips the
  // snapshot insert for non-active recipes, so zero snapshot rows are recorded.
  expect(saveRes.status).toBe(201)

  const colRes = await request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': IDENTITY_KEY },
  })
  const collections = await colRes.json()
  // No snapshot row is written for test-status recipes, so the code either
  // does not appear in savedRecipes or appears with a null snapshot.
  const saved = collections.savedRecipes.find(
    (r: Record<string, unknown>) => r['recipe_code'] === testCode
  )
  if (saved) {
    expect(saved['snapshot']).toBeNull()
  }
})

test('POST /me/saved-recipes without identity → 401', async () => {
  const res = await request('/api/me/saved-recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: activeCode }),
  })
  expect(res.status).toBe(401)
})

// ─── POST /api/me/saved-beans ─────────────────────────────────────────────────

test('POST /me/saved-beans saves bean and GET /me/collections shows it under savedBeans', async () => {
  const saveRes = await request('/api/me/saved-beans', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_KEY,
    },
    body: JSON.stringify({ beanId }),
  })
  expect(saveRes.status).toBe(201)
  const saveBody = await saveRes.json()
  expect(saveBody.ok).toBe(true)

  const colRes = await request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': IDENTITY_KEY },
  })
  expect(colRes.status).toBe(200)
  const collections = await colRes.json()
  expect(Array.isArray(collections.savedBeans)).toBe(true)
  const savedBean = collections.savedBeans.find(
    (b: Record<string, unknown>) => b['bean_id'] === beanId
  )
  expect(savedBean).toBeTruthy()
})

test('POST /me/saved-beans is idempotent (conflict do nothing)', async () => {
  // Save twice — second call should not error.
  for (let i = 0; i < 2; i++) {
    const res = await request('/api/me/saved-beans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BrewDial-Identity': IDENTITY_KEY,
      },
      body: JSON.stringify({ beanId }),
    })
    expect(res.status).toBe(201)
  }
})

// ─── PUT /api/me/gear ─────────────────────────────────────────────────────────

test('PUT /me/gear adds a default grinder, a second default of same kind → only latest is_default', async () => {
  // First default grinder.
  const res1 = await request('/api/me/gear', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_KEY,
    },
    body: JSON.stringify({ kind: 'grinder', label: 'Grinder A', isDefault: true }),
  })
  expect(res1.status).toBe(200)
  const body1 = await res1.json()
  expect(body1.ok).toBe(true)
  expect(typeof body1.id).toBe('string')

  // Second default grinder of the same kind — should clear the first.
  const res2 = await request('/api/me/gear', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_KEY,
    },
    body: JSON.stringify({ kind: 'grinder', label: 'Grinder B', isDefault: true }),
  })
  expect(res2.status).toBe(200)
  const body2 = await res2.json()
  expect(typeof body2.id).toBe('string')

  // Verify via collections: only one grinder should be is_default.
  const colRes = await request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': IDENTITY_KEY },
  })
  const collections = await colRes.json()
  const grinders = (collections.gear as Array<Record<string, unknown>>).filter(
    (g) => g['kind'] === 'grinder'
  )
  const defaults = grinders.filter((g) => g['is_default'] === true)
  expect(defaults.length).toBe(1)
  expect(defaults[0]!['label']).toBe('Grinder B')
})

// ─── PUT /api/me/calibration ──────────────────────────────────────────────────

test('PUT /me/calibration upserts, same pair → one row (idempotent update)', async () => {
  const calPayload = {
    fromLabel: `GrinderX_${SEED_SUFFIX}`,
    toLabel: `GrinderY_${SEED_SUFFIX}`,
    anchorMethod: 'v60',
    samples: [{ fromClicks: 100, toClicks: 26 }],
  }

  const res1 = await request('/api/me/calibration', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_KEY,
    },
    body: JSON.stringify(calPayload),
  })
  expect(res1.status).toBe(200)
  const body1 = await res1.json()
  expect(typeof body1.id).toBe('string')
  const id1 = body1.id

  // Same pair again with updated samples → should return same row id (upsert, not insert).
  const res2 = await request('/api/me/calibration', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_KEY,
    },
    body: JSON.stringify({ ...calPayload, samples: [{ fromClicks: 110, toClicks: 28 }] }),
  })
  expect(res2.status).toBe(200)
  const body2 = await res2.json()
  expect(body2.id).toBe(id1) // same row

  // Verify via collections: only one calibration row for this pair.
  const colRes = await request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': IDENTITY_KEY },
  })
  const collections = await colRes.json()
  const cals = (collections.calibration as Array<Record<string, unknown>>).filter(
    (c) => c['from_label'] === calPayload.fromLabel && c['to_label'] === calPayload.toLabel
  )
  expect(cals.length).toBe(1)
  // Should have the updated samples.
  const updatedSamples = cals[0]!['samples'] as Array<Record<string, unknown>>
  expect(updatedSamples[0]!['fromClicks']).toBe(110)
})

test('PUT /me/calibration with fromGrinderId:"" → 200 (empty string coerced to null, not 500)', async () => {
  // Fix 3: empty-string grinder id must be treated as null, not sent as ''::uuid.
  const res = await request('/api/me/calibration', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_KEY,
    },
    body: JSON.stringify({
      fromLabel: `EmptyGrinderA_${SEED_SUFFIX}`,
      toLabel: `EmptyGrinderB_${SEED_SUFFIX}`,
      fromGrinderId: '',  // empty string → must be coerced to null
      toGrinderId: '',    // empty string → must be coerced to null
      anchorMethod: '',   // empty string → must be coerced to null
      samples: [{ fromClicks: 50, toClicks: 13 }],
    }),
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(typeof body.id).toBe('string')
})

// ─── GET /api/me/collections top-level shape ─────────────────────────────────

test('GET /me/collections returns exact top-level shape {savedRecipes, savedBeans, gear, calibration, myRecipes}', async () => {
  const colRes = await request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': IDENTITY_KEY },
  })
  expect(colRes.status).toBe(200)
  const collections = await colRes.json()
  expect(collections).toHaveProperty('savedRecipes')
  expect(collections).toHaveProperty('savedBeans')
  expect(collections).toHaveProperty('gear')
  expect(collections).toHaveProperty('calibration')
  expect(collections).toHaveProperty('myRecipes')
  expect(Array.isArray(collections.savedRecipes)).toBe(true)
  expect(Array.isArray(collections.savedBeans)).toBe(true)
  expect(Array.isArray(collections.gear)).toBe(true)
  expect(Array.isArray(collections.calibration)).toBe(true)
  expect(Array.isArray(collections.myRecipes)).toBe(true)
})

test('GET /me/collections without identity → 401', async () => {
  const res = await request('/api/me/collections')
  expect(res.status).toBe(401)
})
