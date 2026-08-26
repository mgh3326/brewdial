/**
 * shape.test.ts — Task 6 shape-parity check
 *
 * Verifies that the mounted app's API responses contain at least all keys that
 * the miniapp client mapper expects (RECIPE_COLUMNS, FEEDBACK_COLUMNS), and that
 * /me/collections returns the exact documented top-level shape.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'
import { request } from '../test/request.js'

// ── Column sets the client expects ──────────────────────────────────────────
// Taken verbatim from apps/miniapp/src/lib/data/mappers.ts
const RECIPE_COLUMNS =
  'id,code,method,title,version,params,steps,bean_id,bean_snapshot,intent,notes,adjustment_from_previous,created_by,owner_id,is_official,dripper_portability,status,supersedes,superseded_by,parent_code,created_at,updated_at'

const FEEDBACK_COLUMNS =
  'id,recipe_code,bean_id,ratings,actual,comment,raw_comment,quick_tags,desired_direction,next_hint,source,created_at,updated_at'

const recipeColumnSet = new Set(RECIPE_COLUMNS.split(','))
const feedbackColumnSet = new Set(FEEDBACK_COLUMNS.split(','))

// ── Seed state ───────────────────────────────────────────────────────────────
const SEED_SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)
const recipeCode = `T-SHAPE-${SEED_SUFFIX}`
const feedbackId = randomUUID()
const identityKey = `toss_anon:shape_${SEED_SUFFIX}_${'0'.repeat(20)}`

beforeAll(async () => {
  const db = getDb()

  // Seed one active recipe.
  await db
    .insertInto('recipes')
    .values({
      code: recipeCode,
      method: 'v60',
      title: `Shape Test Recipe ${SEED_SUFFIX}`,
      status: 'active',
      owner_id: null,
    })
    .execute()

  // Seed one feedback row for it.
  await db
    .insertInto('feedback')
    .values({
      id: feedbackId,
      recipe_code: recipeCode,
      source: 'web',
    })
    .execute()
})

afterAll(async () => {
  const db = getDb()
  await db.deleteFrom('feedback').where('id', '=', feedbackId).execute()
  await db.deleteFrom('recipes').where('code', '=', recipeCode).execute()
  await closeDb()
})

// ── Smoke: basic route resolution ───────────────────────────────────────────

describe('route smoke tests', () => {
  test('GET /api/health → 200', async () => {
    const res = await request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('GET /api/me/collections without identity → 401', async () => {
    const res = await request('/api/me/collections')
    expect(res.status).toBe(401)
  })
})

// ── Shape-parity: /api/recipes ───────────────────────────────────────────────

describe('GET /api/recipes shape parity', () => {
  test('every RECIPE_COLUMNS key is present in each row', async () => {
    const res = await request('/api/recipes')
    expect(res.status).toBe(200)
    const rows: Array<Record<string, unknown>> = await res.json()

    // At least our seeded recipe must be there.
    const row = rows.find((r) => r['code'] === recipeCode)
    expect(row).toBeTruthy()

    for (const key of recipeColumnSet) {
      expect(row, `missing key: ${key}`).toHaveProperty(key)
    }
  })
})

// ── Shape-parity: /api/recipes/:code/feedback ────────────────────────────────

describe('GET /api/recipes/:code/feedback shape parity', () => {
  test('every FEEDBACK_COLUMNS key is present in each row', async () => {
    const res = await request(`/api/recipes/${recipeCode}/feedback`)
    expect(res.status).toBe(200)
    const rows: Array<Record<string, unknown>> = await res.json()

    const fb = rows.find((r) => r['id'] === feedbackId)
    expect(fb).toBeTruthy()

    for (const key of feedbackColumnSet) {
      expect(fb, `missing key: ${key}`).toHaveProperty(key)
    }
  })
})

// ── Shape-parity: /api/me/collections ────────────────────────────────────────

describe('GET /api/me/collections shape parity', () => {
  test('top-level keys === [savedRecipes, savedBeans, gear, calibration, myRecipes]', async () => {
    // First save a recipe so the identity exists and collections are non-trivially populated.
    const saveRes = await request('/api/me/saved-recipes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BrewDial-Identity': identityKey,
      },
      body: JSON.stringify({ code: recipeCode }),
    })
    expect(saveRes.status).toBe(201)

    const colRes = await request('/api/me/collections', {
      headers: { 'X-BrewDial-Identity': identityKey },
    })
    expect(colRes.status).toBe(200)
    const collections = await colRes.json()

    const topLevelKeys = Object.keys(collections).sort()
    expect(topLevelKeys).toEqual(
      ['savedRecipes', 'savedBeans', 'gear', 'calibration', 'myRecipes'].sort()
    )

    expect(Array.isArray(collections.savedRecipes)).toBe(true)
    expect(Array.isArray(collections.savedBeans)).toBe(true)
    expect(Array.isArray(collections.gear)).toBe(true)
    expect(Array.isArray(collections.calibration)).toBe(true)
    expect(Array.isArray(collections.myRecipes)).toBe(true)
  })
})
