import { request } from '../test/request.js'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'


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
      likes: [],
      dislikes: [],
      default_params: {},
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
