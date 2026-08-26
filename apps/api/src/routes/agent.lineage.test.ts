import { request } from '../test/request.js'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb, insertAgentRecipe } from '@brewdial/db'


const SEED_SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)
const createdCodes: string[] = []

beforeAll(async () => {
  process.env.AGENT_TOKEN = 'test-token'
})

afterAll(async () => {
  const db = getDb()
  if (createdCodes.length > 0) {
    await db.deleteFrom('recipes').where('code', 'in', createdCodes).execute()
  }
  await closeDb()
})

function agentReq(path: string, options?: RequestInit): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
      ...((options?.headers as Record<string, string>) ?? {}),
    },
    ...options,
  })
}

// ─── PATCH /api/agent/recipes/:code — update editable fields ─────────────────

test('PATCH /api/agent/recipes/:code {title} → 200, version incremented, title updated', async () => {
  const db = getDb()
  const row = await insertAgentRecipe(db, { method: 'v60', title: `Lineage Update Seed ${SEED_SUFFIX}` })
  createdCodes.push(row.code)
  expect(row.version).toBe(1)

  const res = await request(
    agentReq(`/api/agent/recipes/${row.code}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated Title' }),
    })
  )
  expect(res.status).toBe(200)
  const updated: Record<string, unknown> = await res.json()
  expect(updated['code']).toBe(row.code)
  expect(updated['title']).toBe('Updated Title')
  expect(updated['version']).toBe(2)
})

test('PATCH /api/agent/recipes/:code with unknown code → 404', async () => {
  const res = await request(
    agentReq(`/api/agent/recipes/DOES-NOT-EXIST-${SEED_SUFFIX}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Ghost' }),
    })
  )
  expect(res.status).toBe(404)
})

test('PATCH /api/agent/recipes/:code without agent token → 401', async () => {
  const res = await request(`/api/agent/recipes/any-code`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'No Auth' }),
  })
  expect(res.status).toBe(401)
})

// ─── PATCH /api/agent/recipes/:code/status ───────────────────────────────────

test('PATCH /api/agent/recipes/:code/status {status:archived} → 200, status=archived', async () => {
  const db = getDb()
  const row = await insertAgentRecipe(db, { method: 'v60', title: `Lineage Status Seed ${SEED_SUFFIX}` })
  createdCodes.push(row.code)

  const res = await request(
    agentReq(`/api/agent/recipes/${row.code}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    })
  )
  expect(res.status).toBe(200)
  const updated: Record<string, unknown> = await res.json()
  expect(updated['status']).toBe('archived')
  expect(updated['code']).toBe(row.code)
})

test('PATCH /api/agent/recipes/:code/status with invalid status → 400', async () => {
  const db = getDb()
  const row = await insertAgentRecipe(db, { method: 'v60', title: `Lineage BadStatus ${SEED_SUFFIX}` })
  createdCodes.push(row.code)

  const res = await request(
    agentReq(`/api/agent/recipes/${row.code}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'deleted' }),
    })
  )
  expect(res.status).toBe(400)
})

test('PATCH /api/agent/recipes/:code/status with unknown code → 404', async () => {
  const res = await request(
    agentReq(`/api/agent/recipes/DOES-NOT-EXIST-${SEED_SUFFIX}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    })
  )
  expect(res.status).toBe(404)
})

test('PATCH /api/agent/recipes/:code/status without agent token → 401', async () => {
  const res = await request(`/api/agent/recipes/any-code/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'archived' }),
  })
  expect(res.status).toBe(401)
})

// ─── POST /api/agent/recipes/supersede ───────────────────────────────────────

test('POST /api/agent/recipes/supersede → old.status=superseded + superseded_by, new.supersedes', async () => {
  const db = getDb()
  const oldRow = await insertAgentRecipe(db, { method: 'v60', title: `Lineage Old ${SEED_SUFFIX}` })
  const newRow = await insertAgentRecipe(db, { method: 'v60', title: `Lineage New ${SEED_SUFFIX}` })
  createdCodes.push(oldRow.code, newRow.code)

  const res = await request(
    agentReq('/api/agent/recipes/supersede', {
      method: 'POST',
      body: JSON.stringify({ oldCode: oldRow.code, newCode: newRow.code }),
    })
  )
  expect(res.status).toBe(200)
  const result: Record<string, unknown> = await res.json()
  const old = result['old'] as Record<string, unknown>
  const replacement = result['replacement'] as Record<string, unknown>

  expect(old['status']).toBe('superseded')
  expect(old['superseded_by']).toBe(newRow.code)
  expect(replacement['supersedes']).toBe(oldRow.code)
  expect(replacement['code']).toBe(newRow.code)
})

test('POST /api/agent/recipes/supersede with oldCode===newCode → 400 (self-supersede guard)', async () => {
  const db = getDb()
  const row = await insertAgentRecipe(db, { method: 'v60', title: `Lineage SelfSupersede ${SEED_SUFFIX}` })
  createdCodes.push(row.code)

  const res = await request(
    agentReq('/api/agent/recipes/supersede', {
      method: 'POST',
      body: JSON.stringify({ oldCode: row.code, newCode: row.code }),
    })
  )
  expect(res.status).toBe(400)
  const body: Record<string, unknown> = await res.json()
  expect(body['error']).toBe('cannot supersede a recipe with itself')

  // Verify no self-referential row was written.
  const fresh = await db
    .selectFrom('recipes')
    .select(['status', 'superseded_by', 'supersedes'])
    .where('code', '=', row.code)
    .executeTakeFirst()
  expect(fresh?.status).toBe('active')
  expect(fresh?.superseded_by).toBeNull()
  expect(fresh?.supersedes).toBeNull()
})

test('POST /api/agent/recipes/supersede with unknown oldCode → 404', async () => {
  const db = getDb()
  const newRow = await insertAgentRecipe(db, { method: 'v60', title: `Lineage Supersede404 ${SEED_SUFFIX}` })
  createdCodes.push(newRow.code)

  const res = await request(
    agentReq('/api/agent/recipes/supersede', {
      method: 'POST',
      body: JSON.stringify({ oldCode: `DOES-NOT-EXIST-${SEED_SUFFIX}`, newCode: newRow.code }),
    })
  )
  expect(res.status).toBe(404)
})

test('POST /api/agent/recipes/supersede without agent token → 401', async () => {
  const res = await request('/api/agent/recipes/supersede', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oldCode: 'a', newCode: 'b' }),
  })
  expect(res.status).toBe(401)
})
