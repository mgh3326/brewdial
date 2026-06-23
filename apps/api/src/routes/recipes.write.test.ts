import { Hono } from 'hono'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'
import { recipes } from './recipes.js'
import { feedback } from './feedback.js'

// Build a self-contained Hono app for write tests.
function makeApp() {
  const app = new Hono()
  app.route('/api/recipes', recipes)
  app.route('/api/recipes', feedback)
  return app
}

const app = makeApp()

// Track rows created by tests so we can clean up afterward (re-run safe).
const createdCodes: string[] = []
const createdFeedbackIds: string[] = []

afterAll(async () => {
  const db = getDb()
  if (createdFeedbackIds.length > 0) {
    await db.deleteFrom('feedback').where('id', 'in', createdFeedbackIds).execute()
  }
  if (createdCodes.length > 0) {
    await db.deleteFrom('recipes').where('code', 'in', createdCodes).execute()
  }
  await closeDb()
})

// ─── POST /api/recipes ────────────────────────────────────────────────────────

test('POST /api/recipes {method,title} → 201, server-controlled fields', async () => {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'v60', title: 'Write Test Basic' }),
  })
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(row['created_by']).toBe('manual')
  expect(row['version']).toBe(1)
  expect(row['status']).toBe('active')
  expect(row['owner_id']).toBeNull()
  expect(typeof row['code']).toBe('string')
  createdCodes.push(row['code'] as string)
})

test('POST /api/recipes with beanSnapshot (no beanId) → bean_id non-null (trigger linked)', async () => {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'aeropress',
      title: 'Write Test Bean Snapshot',
      beanSnapshot: { name: 'Test Bean WTB', roaster: 'Test Roaster WTB' },
    }),
  })
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  // The recipes_link_bean BEFORE-INSERT trigger should have linked/deduped the bean.
  expect(row['bean_id']).not.toBeNull()
  expect(row['created_by']).toBe('manual')
  createdCodes.push(row['code'] as string)
})

test('POST /api/recipes with injected owner_id/is_official/created_by → all ignored', async () => {
  const fakeOwnerId = randomUUID()
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'kalita',
      title: 'Write Test Injection Probe',
      owner_id: fakeOwnerId,
      is_official: true,
      created_by: 'agent',
    }),
  })
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  // Body injection must be silently dropped; guard enforces the same.
  expect(row['owner_id']).toBeNull()
  expect(row['is_official']).toBe(false)
  expect(row['created_by']).toBe('manual')
  createdCodes.push(row['code'] as string)
})

// ─── POST /api/recipes/:code/feedback ────────────────────────────────────────

test('POST /api/recipes/:code/feedback {rawComment} → 201, source defaults to web', async () => {
  // First create a recipe to attach feedback to.
  const recipeRes = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'v60', title: 'Write Test Feedback Target' }),
  })
  expect(recipeRes.status).toBe(201)
  const recipe: Record<string, unknown> = await recipeRes.json()
  const code = recipe['code'] as string
  createdCodes.push(code)

  const res = await app.request(`/api/recipes/${code}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawComment: 'Great cup, slightly acidic' }),
  })
  expect(res.status).toBe(201)
  const fb: Record<string, unknown> = await res.json()
  expect(fb['source']).toBe('web')
  expect(fb['recipe_code']).toBe(code)
  expect(fb['raw_comment']).toBe('Great cup, slightly acidic')
  expect(typeof fb['id']).toBe('string')
  createdFeedbackIds.push(fb['id'] as string)
})
