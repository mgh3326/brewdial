/**
 * agent.beans.test.ts — ROB-654 PATCH /api/agent/beans/:id
 *
 * The agent-gated write path for structured bean attributes. Confirms:
 *   - valid attribute writes persist and surface via the bean_summaries view
 *   - partial patches only touch provided fields
 *   - the shared validator + DB CHECKs reject bad values with 400 (not 500)
 *   - unknown bean id → 404, and the agentAuth gate applies
 */
import { Hono } from 'hono'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'
import { agentRouter } from './agent.js'
import { agentAuth } from '../middleware/agent-auth.js'

function makeApp() {
  const app = new Hono()
  app.use('/api/agent/*', agentAuth)
  app.route('/api/agent', agentRouter)
  return app
}
const app = makeApp()

const SEED = randomUUID().replace(/-/g, '').slice(0, 8)
let beanId: string

beforeAll(async () => {
  process.env.AGENT_TOKEN = 'test-token'
  const db = getDb()
  const row = await db
    .insertInto('beans')
    .values({ name: `Agent Attr Bean ${SEED}`, roaster: `Roaster ${SEED}` })
    .returning('id')
    .executeTakeFirstOrThrow()
  beanId = row.id
})

afterAll(async () => {
  const db = getDb()
  await db.deleteFrom('beans').where('id', '=', beanId).execute()
  await closeDb()
})

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

test('PATCH /api/agent/beans/:id valid attrs → 200, persisted + surfaced via view', async () => {
  const res = await app.request(agentReq(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      roastLevelOrd: 4,
      agtronMin: 57,
      agtronMax: 59,
      acidity: 1,
      body: 5,
      decaf: false,
      flavorCategories: ['nutty_cocoa', 'sweet'],
      attrsSource: 'roaster_page',
      sourceUrl: 'https://example.com/bean',
      attrsNotes: '산미1/무게감4.5',
    }),
  }))
  expect(res.status).toBe(200)
  const row: Record<string, unknown> = await res.json()
  expect(row['id']).toBe(beanId)
  expect(row['roast_level_ord']).toBe(4)
  expect(row['agtron_min']).toBe(57)
  expect(row['agtron_max']).toBe(59)
  expect(row['acidity']).toBe(1)
  expect(row['body']).toBe(5)
  expect(row['decaf']).toBe(false)
  expect(row['flavor_categories']).toEqual(['nutty_cocoa', 'sweet'])
  expect(row['attrs_source']).toBe('roaster_page')
  expect(row['attrs_notes']).toBe('산미1/무게감4.5')
})

test('PATCH partial → only provided fields change', async () => {
  const res = await app.request(agentReq(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    body: JSON.stringify({ acidity: 3 }),
  }))
  expect(res.status).toBe(200)
  const row: Record<string, unknown> = await res.json()
  expect(row['acidity']).toBe(3)
  expect(row['body']).toBe(5) // unchanged from previous write
})

test('PATCH acidity=9 (out of 1..5) → 400', async () => {
  const res = await app.request(agentReq(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    body: JSON.stringify({ acidity: 9 }),
  }))
  expect(res.status).toBe(400)
})

test('PATCH unknown flavor category → 400', async () => {
  const res = await app.request(agentReq(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    body: JSON.stringify({ flavorCategories: ['chocolate'] }),
  }))
  expect(res.status).toBe(400)
})

test('PATCH agtronMax < agtronMin (both in one request) → 400', async () => {
  const res = await app.request(agentReq(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    body: JSON.stringify({ agtronMin: 90, agtronMax: 50 }),
  }))
  expect(res.status).toBe(400)
})

test('PATCH partial agtron that inverts the STORED bound → 400 (not a raw CHECK 500)', async () => {
  // Persist a valid range first.
  const seed = await app.request(agentReq(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    body: JSON.stringify({ agtronMin: 57, agtronMax: 59 }),
  }))
  expect(seed.status).toBe(200)
  // Then send ONLY agtronMax, below the stored agtron_min — validator skips the
  // cross-check (single field), so the repo's merged-range guard must catch it as 400.
  const res = await app.request(agentReq(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    body: JSON.stringify({ agtronMax: 40 }),
  }))
  expect(res.status).toBe(400)
  // Symmetric: only agtronMin, above the stored agtron_max.
  const res2 = await app.request(agentReq(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    body: JSON.stringify({ agtronMin: 90 }),
  }))
  expect(res2.status).toBe(400)
})

test('PATCH empty body → 400 (at least one attribute required)', async () => {
  const res = await app.request(agentReq(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }))
  expect(res.status).toBe(400)
})

test('PATCH unknown bean id → 404', async () => {
  const res = await app.request(agentReq('/api/agent/beans/00000000-0000-0000-0000-000000000000', {
    method: 'PATCH',
    body: JSON.stringify({ acidity: 2 }),
  }))
  expect(res.status).toBe(404)
})

test('PATCH without agent token → 401', async () => {
  const res = await app.request(`/api/agent/beans/${beanId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ acidity: 2 }),
  })
  expect(res.status).toBe(401)
})
