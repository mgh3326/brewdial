import { Hono } from 'hono'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'
import { identityMiddleware } from '../middleware/identity.js'
import { recipes } from './recipes.js'
import { feedback } from './feedback.js'

// Build a self-contained Hono app for write tests.
function makeApp() {
  const app = new Hono()
  app.use('*', identityMiddleware)
  app.route('/api/recipes', recipes)
  app.route('/api/recipes', feedback)
  return app
}

const app = makeApp()

// Track rows created by tests so we can clean up afterward (re-run safe).
const createdCodes: string[] = []
const createdFeedbackIds: string[] = []
const createdBeanIds: string[] = []

// External key must be >=16 chars; identityMiddleware rejects shorter keys.
const SEED = randomUUID().replace(/-/g, '').slice(0, 8)
const IDENTITY_A = `toss_anon:wtestA_${SEED}_${'0'.repeat(20)}`
const IDENTITY_B = `toss_anon:wtestB_${SEED}_${'0'.repeat(20)}`

let privateRecipeCode = ''
let privateBeanId = ''

afterAll(async () => {
  const db = getDb()
  if (createdFeedbackIds.length > 0) {
    await db.deleteFrom('feedback').where('id', 'in', createdFeedbackIds).execute()
  }
  if (createdCodes.length > 0) {
    await db.deleteFrom('recipes').where('code', 'in', createdCodes).execute()
  }
  if (createdBeanIds.length > 0) {
    await db.deleteFrom('beans').where('id', 'in', createdBeanIds).execute()
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

// ─── Feedback source restriction (Fix 1) ─────────────────────────────────────

test('POST feedback with source:agent → 400 (anon caller must not self-declare agent)', async () => {
  const recipeRes = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'v60', title: 'Write Test Source Restriction' }),
  })
  expect(recipeRes.status).toBe(201)
  const recipe: Record<string, unknown> = await recipeRes.json()
  const code = recipe['code'] as string
  createdCodes.push(code)

  const res = await app.request(`/api/recipes/${code}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawComment: 'Trying agent source', source: 'agent' }),
  })
  expect(res.status).toBe(400)
  const body: Record<string, unknown> = await res.json()
  expect(body['error']).toBe('invalid source')
})

test('POST feedback with source:mcp → 400', async () => {
  const recipeRes = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'v60', title: 'Write Test Source Restriction MCP' }),
  })
  expect(recipeRes.status).toBe(201)
  const recipe: Record<string, unknown> = await recipeRes.json()
  const code = recipe['code'] as string
  createdCodes.push(code)

  const res = await app.request(`/api/recipes/${code}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawComment: 'Trying mcp source', source: 'mcp' }),
  })
  expect(res.status).toBe(400)
})

test('POST feedback with source:coffee_profile → 201 (allowed anon source)', async () => {
  const recipeRes = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'v60', title: 'Write Test Source Coffee Profile' }),
  })
  expect(recipeRes.status).toBe(201)
  const recipe: Record<string, unknown> = await recipeRes.json()
  const code = recipe['code'] as string
  createdCodes.push(code)

  const res = await app.request(`/api/recipes/${code}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawComment: 'From coffee profile', source: 'coffee_profile' }),
  })
  expect(res.status).toBe(201)
  const fb: Record<string, unknown> = await res.json()
  expect(fb['source']).toBe('coffee_profile')
  createdFeedbackIds.push(fb['id'] as string)
})

// ─── Nonexistent recipe code → 404 (Fix 2) ───────────────────────────────────

test('POST feedback to a nonexistent recipe code → 404', async () => {
  const res = await app.request('/api/recipes/DOES-NOT-EXIST-999/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawComment: 'Ghost recipe' }),
  })
  expect(res.status).toBe(404)
  const body: Record<string, unknown> = await res.json()
  expect(body['error']).toBe('recipe not found')
})

// ─── ROB-634: owner_id write path + private listing policy ───────────────────

test('POST /api/recipes with X-BrewDial-Identity → 201, owner_id = caller appUserId (private)', async () => {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_A,
    },
    body: JSON.stringify({ method: 'v60', title: 'Private Owned Recipe' }),
  })
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(row['owner_id']).not.toBeNull()
  expect(typeof row['owner_id']).toBe('string')
  expect(row['created_by']).toBe('manual')
  privateRecipeCode = row['code'] as string
  createdCodes.push(privateRecipeCode)
})

test('POST /api/recipes WITHOUT identity → 201, owner_id null (public)', async () => {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'v60', title: 'Public No Identity' }),
  })
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(row['owner_id']).toBeNull()
  createdCodes.push(row['code'] as string)
})

test('GET /api/recipes (global feed) excludes private recipes', async () => {
  // Ensure Test 1 created its private recipe first.
  expect(privateRecipeCode).toBeTruthy()
  const res = await app.request('/api/recipes?limit=100', {
    headers: { 'X-BrewDial-Identity': IDENTITY_A },
  })
  expect(res.status).toBe(200)
  const rows = (await res.json()) as Array<Record<string, unknown>>
  const codes = rows.map((r) => r['code'])
  expect(codes).not.toContain(privateRecipeCode)
  // Every row in the global feed must be public (owner_id null).
  for (const r of rows) expect(r['owner_id']).toBeNull()
})

test('GET /api/recipes?beanId= returns own private + public; others see public only', async () => {
  // Seed a bean and create a private recipe tied to it under IDENTITY_A.
  const db = getDb()
  privateBeanId = randomUUID()
  await db.insertInto('beans').values({ id: privateBeanId, name: `Privacy Bean ${SEED}` }).execute()
  createdBeanIds.push(privateBeanId)

  const createRes = await app.request('/api/recipes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_A,
    },
    body: JSON.stringify({
      method: 'v60',
      title: 'Private Recipe For Bean',
      beanId: privateBeanId,
    }),
  })
  expect(createRes.status).toBe(201)
  const created: Record<string, unknown> = await createRes.json()
  expect(created['owner_id']).not.toBeNull()
  const privateCode = created['code'] as string
  createdCodes.push(privateCode)

  // Owner sees their private recipe for this bean.
  const ownerRes = await app.request(`/api/recipes?beanId=${privateBeanId}`, {
    headers: { 'X-BrewDial-Identity': IDENTITY_A },
  })
  const ownerRows = (await ownerRes.json()) as Array<Record<string, unknown>>
  const ownerCodes = ownerRows.map((r) => r['code'])
  expect(ownerCodes).toContain(privateCode)

  // A different identity does NOT see the private recipe.
  const otherRes = await app.request(`/api/recipes?beanId=${privateBeanId}`, {
    headers: { 'X-BrewDial-Identity': IDENTITY_B },
  })
  const otherRows = (await otherRes.json()) as Array<Record<string, unknown>>
  const otherCodes = otherRows.map((r) => r['code'])
  expect(otherCodes).not.toContain(privateCode)

  // No identity also does NOT see the private recipe.
  const anonRes = await app.request(`/api/recipes?beanId=${privateBeanId}`)
  const anonRows = (await anonRes.json()) as Array<Record<string, unknown>>
  const anonCodes = anonRows.map((r) => r['code'])
  expect(anonCodes).not.toContain(privateCode)
})

test('GET /api/recipes/:code deep-link privacy — owner 200, others 404', async () => {
  expect(privateRecipeCode).toBeTruthy()
  // Owner reads own private recipe.
  const ownerRes = await app.request(`/api/recipes/${privateRecipeCode}`, {
    headers: { 'X-BrewDial-Identity': IDENTITY_A },
  })
  expect(ownerRes.status).toBe(200)

  // Different identity → 404.
  const otherRes = await app.request(`/api/recipes/${privateRecipeCode}`, {
    headers: { 'X-BrewDial-Identity': IDENTITY_B },
  })
  expect(otherRes.status).toBe(404)

  // No identity → 404.
  const anonRes = await app.request(`/api/recipes/${privateRecipeCode}`)
  expect(anonRes.status).toBe(404)
})

// ─── ROB-642 C2: feedback subresource owner privacy ────────────────────────────

test('GET /api/recipes/:code/feedback: owner sees own private, others/anon → 404', async () => {
  expect(privateRecipeCode).toBeTruthy()

  // Owner (IDENTITY_A) → 200 (may be empty array).
  const ownerRes = await app.request(`/api/recipes/${privateRecipeCode}/feedback`, {
    headers: { 'X-BrewDial-Identity': IDENTITY_A },
  })
  expect(ownerRes.status).toBe(200)

  // Different identity → 404 (visibility gate).
  const otherRes = await app.request(`/api/recipes/${privateRecipeCode}/feedback`, {
    headers: { 'X-BrewDial-Identity': IDENTITY_B },
  })
  expect(otherRes.status).toBe(404)

  // No identity → 404.
  const anonRes = await app.request(`/api/recipes/${privateRecipeCode}/feedback`)
  expect(anonRes.status).toBe(404)
})

test('POST /api/recipes/:code/feedback: owner can post on own private, others/anon → 404', async () => {
  expect(privateRecipeCode).toBeTruthy()

  // Owner → 201.
  const ownerRes = await app.request(`/api/recipes/${privateRecipeCode}/feedback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_A,
    },
    body: JSON.stringify({ rawComment: 'owner feedback on private' }),
  })
  expect(ownerRes.status).toBe(201)
  const fb: Record<string, unknown> = await ownerRes.json()
  if (typeof fb['id'] === 'string') createdFeedbackIds.push(fb['id'])

  // Different identity → 404.
  const otherRes = await app.request(`/api/recipes/${privateRecipeCode}/feedback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-BrewDial-Identity': IDENTITY_B,
    },
    body: JSON.stringify({ rawComment: 'intruder' }),
  })
  expect(otherRes.status).toBe(404)

  // No identity → 404.
  const anonRes = await app.request(`/api/recipes/${privateRecipeCode}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawComment: 'anon' }),
  })
  expect(anonRes.status).toBe(404)
})
