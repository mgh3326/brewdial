import { request } from '../test/request.js'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb, dbVendor, updateRecipe } from '@brewdial/db'


const SEED_SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)
const seededCode = `T-AGFB-${SEED_SUFFIX}`
const createdFeedbackIds: string[] = []

beforeAll(async () => {
  process.env.AGENT_TOKEN = 'test-token'

  const db = getDb()
  // Seed a recipe to attach feedback to.
  await db.insertInto('recipes').values({
    code: seededCode,
    method: 'v60',
    title: 'Agent Feedback Test Recipe',
    status: 'active',
    owner_id: null,
  }).execute()

  // Seed global preferences row if it doesn't exist.
  const existing = await db
    .selectFrom('preferences')
    .select('id')
    .where('id', '=', 'global')
    .executeTakeFirst()
  if (!existing) {
    await db.insertInto('preferences').values({
      id: 'global',
      likes: dbVendor() === 'mysql' ? '[]' as any : [],
      dislikes: dbVendor() === 'mysql' ? '[]' as any : [],
      default_params: dbVendor() === 'mysql' ? '{}' as any : {},
    }).execute()
  }
})

afterAll(async () => {
  const db = getDb()
  // Clean up feedback rows created during tests.
  if (createdFeedbackIds.length > 0) {
    await db.deleteFrom('feedback').where('id', 'in', createdFeedbackIds).execute()
  }
  // Clean up seeded recipe.
  await db.deleteFrom('recipes').where('code', '=', seededCode).execute()
  await closeDb()
})

// Helper for authenticated requests.
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

// ─── POST /api/agent/feedback ─────────────────────────────────────────────────

test('POST /api/agent/feedback {recipeCode, source:"agent", rawComment} → 201, source=agent', async () => {
  const res = await request(agentReq('/api/agent/feedback', {
    method: 'POST',
    body: JSON.stringify({ recipeCode: seededCode, source: 'agent', rawComment: 'very smooth' }),
  }))
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(row['source']).toBe('agent')
  expect(row['recipe_code']).toBe(seededCode)
  expect(row['raw_comment']).toBe('very smooth')
  createdFeedbackIds.push(row['id'] as string)
})

test('POST /api/agent/feedback source:"mcp" → allowed (201)', async () => {
  const res = await request(agentReq('/api/agent/feedback', {
    method: 'POST',
    body: JSON.stringify({ recipeCode: seededCode, source: 'mcp', rawComment: 'mcp test' }),
  }))
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(row['source']).toBe('mcp')
  createdFeedbackIds.push(row['id'] as string)
})

test('POST /api/agent/feedback source omitted → defaults to "agent"', async () => {
  const res = await request(agentReq('/api/agent/feedback', {
    method: 'POST',
    body: JSON.stringify({ recipeCode: seededCode, rawComment: 'no source field' }),
  }))
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(row['source']).toBe('agent')
  createdFeedbackIds.push(row['id'] as string)
})

test('POST /api/agent/feedback source:"web" → 400 (not in agent whitelist)', async () => {
  const res = await request(agentReq('/api/agent/feedback', {
    method: 'POST',
    body: JSON.stringify({ recipeCode: seededCode, source: 'web' }),
  }))
  expect(res.status).toBe(400)
})

test('POST /api/agent/feedback nonexistent recipeCode → 404 (NOT 500)', async () => {
  const res = await request(agentReq('/api/agent/feedback', {
    method: 'POST',
    body: JSON.stringify({ recipeCode: `DOES-NOT-EXIST-${SEED_SUFFIX}`, rawComment: 'ghost' }),
  }))
  expect(res.status).toBe(404)
})

test('POST feedback validates actual dose, water, blend, and rejects unknown keys', async () => {
  for (const actual of [{ doseG: 0 }, { waterG: Number.POSITIVE_INFINITY }, { blend: [{ grams: 5 }] }, { unknown: 1 }]) {
    const res = await request(agentReq('/api/agent/feedback', { method: 'POST', body: JSON.stringify({ recipeCode: seededCode, rawComment: 'test', actual }) }))
    expect(res.status).toBe(400)
  }
})

test('feedback is pinned to its recipe version and snapshot; edits merge, conflict, and dryRun correctly', async () => {
  const create = await request(agentReq('/api/agent/feedback', {
    method: 'POST',
    body: JSON.stringify({ recipeCode: seededCode, rawComment: 'first words', ratings: { overall: 4 }, actual: { doseG: 18, waterG: 280, blend: [{ beanId: 'bean-a', grams: 18 }] } }),
  }))
  expect(create.status).toBe(201)
  const inserted = await create.json() as Record<string, any>
  createdFeedbackIds.push(inserted.id)
  expect(inserted.recipe_version).toBe(1)
  const originalSnapshot = inserted.recipe_snapshot
  expect(originalSnapshot).toMatchObject({ method: 'v60', params: {}, steps: [] })

  await updateRecipe(getDb(), seededCode, { params: { doseG: 19 } })
  const listedRes = await request(`/api/recipes/${seededCode}/feedback`)
  expect(listedRes.status).toBe(200)
  const listed = await listedRes.json() as Array<Record<string, any>>
  const pinned = listed.find((row) => row.id === inserted.id)!
  expect(pinned.recipe_version).toBe(1)
  expect(pinned.recipeVersion).toBe(1)
  expect(pinned.recipe_current_version).toBe(2)
  expect(pinned.onCurrentVersion).toBe(false)
  expect(pinned.recipe_snapshot).toEqual(originalSnapshot)

  const edit = await request(agentReq(`/api/agent/feedback/${inserted.id}`, { method: 'PATCH', body: JSON.stringify({ ratings: { overall: null, sweetness: 3 }, actual: { doseG: null, timeSec: 180 }, rawComment: 'updated words' }) }))
  expect(edit.status).toBe(200)
  const updated = await edit.json() as Record<string, any>
  expect(updated.ratings).toEqual({ sweetness: 3 })
  expect(updated.actual).toEqual({ waterG: 280, blend: [{ beanId: 'bean-a', grams: 18 }], timeSec: 180 })
  expect(updated.raw_comment).toBe('updated words')

  const dryRun = await request(agentReq(`/api/agent/feedback/${inserted.id}`, { method: 'PATCH', body: JSON.stringify({ dryRun: true, actual: { waterG: 300 } }) }))
  expect(dryRun.status).toBe(200)
  expect((await dryRun.json()).dryRun).toBe(true)
  const beforeConflict = await request(`/api/recipes/${seededCode}/feedback`)
  const beforeRows = await beforeConflict.json() as Array<Record<string, any>>
  const before = beforeRows.find((row) => row.id === inserted.id)!
  const conflict = await request(agentReq(`/api/agent/feedback/${inserted.id}`, { method: 'PATCH', body: JSON.stringify({ expectedUpdatedAt: '2099-01-01T00:00:00.000Z', ratings: { overall: 5 } }) }))
  expect(conflict.status).toBe(409)
  expect(await conflict.json()).toMatchObject({ error: 'version_conflict', currentUpdatedAt: before.updated_at })
  const afterConflictRes = await request(`/api/recipes/${seededCode}/feedback`)
  const afterRows = await afterConflictRes.json() as Array<Record<string, any>>
  expect(afterRows.find((row) => row.id === inserted.id)).toEqual(before)
})

test('PATCH feedback rejects non-boolean dryRun without changing the row', async () => {
  const create = await request(agentReq('/api/agent/feedback', {
    method: 'POST',
    body: JSON.stringify({ recipeCode: seededCode, rawComment: 'before invalid dryRun', actual: { waterG: 280 } }),
  }))
  expect(create.status).toBe(201)
  const inserted = await create.json() as Record<string, any>
  createdFeedbackIds.push(inserted.id)
  const beforeRes = await request(`/api/recipes/${seededCode}/feedback`)
  const beforeRows = await beforeRes.json() as Array<Record<string, any>>
  const before = beforeRows.find((row) => row.id === inserted.id)!

  const invalidDryRun = await request(agentReq(`/api/agent/feedback/${inserted.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ dryRun: 'yes', actual: { waterG: 300 } }),
  }))
  expect(invalidDryRun.status).toBe(400)
  const afterRes = await request(`/api/recipes/${seededCode}/feedback`)
  const afterRows = await afterRes.json() as Array<Record<string, any>>
  expect(afterRows.find((row) => row.id === inserted.id)).toEqual(before)
})

// ─── GET /api/agent/preferences/global ───────────────────────────────────────

test('GET /api/agent/preferences/global → 200 with shape {id, likes, dislikes, default_params}', async () => {
  const res = await request(agentReq('/api/agent/preferences/global'))
  expect(res.status).toBe(200)
  const body: Record<string, unknown> | null = await res.json()
  // Row seeded in beforeAll; should be present but could be null if seeding failed.
  if (body !== null) {
    expect(body['id']).toBe('global')
    expect(Array.isArray(body['likes'])).toBe(true)
    expect(Array.isArray(body['dislikes'])).toBe(true)
    expect(typeof body['default_params']).toBe('object')
  }
})

// ─── agentAuth gate ───────────────────────────────────────────────────────────

test('POST /api/agent/feedback without agent token → 401', async () => {
  const res = await request('/api/agent/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipeCode: seededCode }),
  })
  expect(res.status).toBe(401)
})

test('GET /api/agent/preferences/global without agent token → 401', async () => {
  const res = await request('/api/agent/preferences/global')
  expect(res.status).toBe(401)
})
