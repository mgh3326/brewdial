import { request } from '../test/request.js'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'


// Track rows created by tests so we can clean them up afterward (re-run safe).
const createdCodes: string[] = []

// Seed suffix and pre-seeded test-status recipe code for any-status read test.
const SEED_SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)
const testStatusCode = `T-AGTST-${SEED_SUFFIX}`
const refStatusCode = `T-AGREF-${SEED_SUFFIX}`

beforeAll(async () => {
  // Set AGENT_TOKEN for all tests (vitest runs in the same process).
  process.env.AGENT_TOKEN = 'test-token'

  const db = getDb()
  // Seed a recipe with status='test' to verify any-status reads.
  await db.insertInto('recipes').values({
    code: testStatusCode,
    method: 'v60',
    title: 'Agent Test Status Recipe',
    status: 'test',
    owner_id: null,
  }).execute()
  // Seed a reference-status recipe for the explicit agent lookup test.
  await db.insertInto('recipes').values({
    code: refStatusCode,
    method: 'v60',
    title: 'Agent Reference Status Recipe',
    status: 'reference',
    owner_id: null,
  }).execute()
})

afterAll(async () => {
  const db = getDb()
  // Clean up the seeded test-status recipe.
  await db.deleteFrom('recipes').where('code', '=', testStatusCode).execute()
  await db.deleteFrom('recipes').where('code', '=', refStatusCode).execute()
  // Clean up any rows created during tests.
  if (createdCodes.length > 0) {
    await db.deleteFrom('recipes').where('code', 'in', createdCodes).execute()
  }
  await closeDb()
})

// Helper to make an authenticated request.
function agentReq(path: string, options?: RequestInit): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer test-token',
      ...(options?.headers as Record<string, string> ?? {}),
    },
    ...options,
  })
}

// ─── POST /api/agent/recipes ─────────────────────────────────────────────────

test('POST /api/agent/recipes {method,title} → 201, created_by=agent, server-controlled fields', async () => {
  const res = await request(agentReq('/api/agent/recipes', {
    method: 'POST',
    body: JSON.stringify({ method: 'v60', title: 'Agent Basic Recipe' }),
  }))
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(row['created_by']).toBe('agent')
  expect(row['owner_id']).toBeNull()
  expect(row['version']).toBe(1)
  expect(row['status']).toBe('active')
  expect(row['is_official']).toBe(false)
  expect(typeof row['code']).toBe('string')
  createdCodes.push(row['code'] as string)
})

test('POST /api/agent/recipes accepts existing parent and rejects missing parent', async () => {
  const parent = await request(agentReq(`/api/agent/recipes/${testStatusCode}`))
  expect(parent.status).toBe(200)
  const created = await request(agentReq('/api/agent/recipes', { method: 'POST', body: JSON.stringify({ method: 'v60', title: 'Child Recipe', parentCode: testStatusCode }) }))
  expect(created.status).toBe(201)
  const row = await created.json()
  expect(row.parent_code).toBe(testStatusCode)
  createdCodes.push(row.code)
  const missing = await request(agentReq('/api/agent/recipes', { method: 'POST', body: JSON.stringify({ method: 'v60', title: 'Missing Parent', parentCode: 'COF-999999' }) }))
  expect(missing.status).toBe(400)
  expect(await missing.json()).toEqual({ error: 'parent not found' })
})

test('GET /api/agent/recipes?parentCode lists direct children oldest first across statuses', async () => {
  const db = getDb()
  const parent = `COF-${SEED_SUFFIX}01`
  const first = `COF-${SEED_SUFFIX}02`
  const second = `COF-${SEED_SUFFIX}03`
  await db.insertInto('recipes').values({ code: parent, method: 'v60', title: 'Lineage Parent', status: 'archived', owner_id: null }).execute()
  await db.insertInto('recipes').values({ code: first, method: 'v60', title: 'First Child', status: 'test', owner_id: null, parent_code: parent, created_at: new Date('2024-01-01T00:00:00Z') }).execute()
  await db.insertInto('recipes').values({ code: second, method: 'v60', title: 'Second Child', status: 'active', owner_id: null, parent_code: parent, created_at: new Date('2024-01-02T00:00:00Z') }).execute()
  createdCodes.push(parent, first, second)
  const response = await request(agentReq(`/api/agent/recipes?parentCode=${parent}`))
  expect(response.status).toBe(200)
  expect((await response.json()).map((r: { code: string }) => r.code)).toEqual([first, second])
  expect((await request(agentReq('/api/agent/recipes'))).status).toBe(400)
  expect((await request(agentReq('/api/agent/recipes?limit=5'))).status).toBe(400)
})

test('POST /api/agent/recipes with beanSnapshot (no beanId) → bean_id non-null (trigger linked)', async () => {
  const res = await request(agentReq('/api/agent/recipes', {
    method: 'POST',
    body: JSON.stringify({
      method: 'aeropress',
      title: 'Agent Bean Snapshot Recipe',
      beanSnapshot: { name: 'Agent Test Bean', roaster: 'Agent Test Roaster' },
    }),
  }))
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  // The recipes_link_bean BEFORE-INSERT trigger should have linked/deduped the bean.
  expect(row['bean_id']).not.toBeNull()
  expect(row['created_by']).toBe('agent')
  expect(row['owner_id']).toBeNull()
  createdCodes.push(row['code'] as string)
})

test('POST /api/agent/recipes with injected owner_id/is_official/created_by → those fields ignored', async () => {
  const fakeOwnerId = randomUUID()
  const res = await request(agentReq('/api/agent/recipes', {
    method: 'POST',
    body: JSON.stringify({
      method: 'kalita',
      title: 'Agent Injection Probe',
      owner_id: fakeOwnerId,
      is_official: true,
      created_by: 'manual',
    }),
  }))
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  // Body injection must be silently stripped; server always sets these.
  expect(row['owner_id']).toBeNull()
  expect(row['is_official']).toBe(false)
  expect(row['created_by']).toBe('agent')
  createdCodes.push(row['code'] as string)
})

test('POST /api/agent/recipes keeps notes whitespace, trims title and adjustmentFromPrevious (#602)', async () => {
  // Notes carry the xBloom machine tag, so their whitespace is data. The API
  // must store them byte-for-byte.
  const notes = '  line one\n  line two\n\n[xbloom]  '
  const res = await request(agentReq('/api/agent/recipes', {
    method: 'POST',
    body: JSON.stringify({
      method: 'v60',
      title: '  Agent Notes Whitespace  ',
      notes,
      adjustmentFromPrevious: '  finer  ',
    }),
  }))
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  createdCodes.push(row['code'] as string)
  expect(row['notes']).toBe(notes)
  expect(row['title']).toBe('Agent Notes Whitespace')
  expect(row['adjustment_from_previous']).toBe('finer')
})

// ─── GET /api/agent/recipes/:code — any-status reads ─────────────────────────

test('GET /api/agent/recipes/:code returns test-status recipe (any-status)', async () => {
  const res = await request(agentReq(`/api/agent/recipes/${testStatusCode}`))
  expect(res.status).toBe(200)
  const row: Record<string, unknown> = await res.json()
  expect(row['code']).toBe(testStatusCode)
  expect(row['status']).toBe('test')
})

test('GET /api/agent/recipes/:code returns reference recipe (explicit agent lookup)', async () => {
  const res = await request(agentReq(`/api/agent/recipes/${refStatusCode}`))
  expect(res.status).toBe(200)
  const row: Record<string, unknown> = await res.json()
  expect(row['code']).toBe(refStatusCode)
  expect(row['status']).toBe('reference')
})

test('GET /api/agent/recipes/:code returns 404 for unknown code', async () => {
  const res = await request(agentReq(`/api/agent/recipes/DOES-NOT-EXIST-${SEED_SUFFIX}`))
  expect(res.status).toBe(404)
})

// ─── agentAuth gate ───────────────────────────────────────────────────────────

test('POST /api/agent/recipes without agent token → 401', async () => {
  const res = await request('/api/agent/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'v60', title: 'No Auth Recipe' }),
  })
  expect(res.status).toBe(401)
})

test('GET /api/agent/recipes/:code without agent token → 401', async () => {
  const res = await request(`/api/agent/recipes/${testStatusCode}`)
  expect(res.status).toBe(401)
})

test('POST /api/agent/recipes with wrong token → 401', async () => {
  const res = await request('/api/agent/recipes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer wrong-token',
    },
    body: JSON.stringify({ method: 'v60', title: 'Wrong Token Recipe' }),
  })
  expect(res.status).toBe(401)
})
