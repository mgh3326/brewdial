import { request } from '../test/request.js'
import { afterAll, beforeAll, expect, test as baseTest } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb, getRecipeAnyStatus, insertAgentRecipe } from '@brewdial/db'

// PATCH /api/agent/recipes/:code — params merge, expectedVersion and dryRun.
// The in-process run covers these on PostgreSQL and MySQL 8.4 in CI. Blackbox runs
// (API_TEST_BASE_URL) skip them; the external server contract does not cover merge.
const test = baseTest.skipIf(!!process.env.API_TEST_BASE_URL)

const SEED = randomUUID().replace(/-/g, '').slice(0, 8)
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

async function seed(title: string, params: unknown) {
  const row = await insertAgentRecipe(getDb(), { method: 'v60', title: `${title} ${SEED}`, params })
  createdCodes.push(row.code)
  return row
}

function patchRecipe(code: string, body: unknown): Promise<Response> {
  return request(agentReq(`/api/agent/recipes/${code}`, { method: 'PATCH', body: JSON.stringify(body) }))
}

test('PATCH params keeps the keys the patch does not send', async () => {
  const row = await seed('Merge Partial', { doseG: 15, waterG: 240, tempC: 92, grinder: 'Comandante' })
  const res = await patchRecipe(row.code, { params: { tempC: 88 } })
  expect(res.status).toBe(200)
  const updated = await res.json()
  expect(updated.version).toBe(2)
  expect(updated.params).toEqual({ doseG: 15, waterG: 240, tempC: 88, grinder: 'Comandante' })
})

test('PATCH params with null removes that key only', async () => {
  const row = await seed('Merge Null', { doseG: 15, grinder: 'Comandante', tempC: 92 })
  const res = await patchRecipe(row.code, { params: { grinder: null } })
  expect(res.status).toBe(200)
  const updated = await res.json()
  expect(updated.params).toEqual({ doseG: 15, tempC: 92 })
  expect(updated.params).not.toHaveProperty('grinder')
})

test('PATCH params keeps a legacy key the validator does not know', async () => {
  const row = await seed('Merge Legacy', { doseG: 15, legacyNote: 'from an old import' })
  const res = await patchRecipe(row.code, { params: { tempC: 90 } })
  expect(res.status).toBe(200)
  const updated = await res.json()
  expect(updated.params).toEqual({ doseG: 15, legacyNote: 'from an old import', tempC: 90 })
})

test('PATCH with a stale expectedVersion → 409 version_conflict, nothing written', async () => {
  const row = await seed('Merge Conflict', { doseG: 15, tempC: 92 })
  const first = await patchRecipe(row.code, { title: `Merge Conflict First ${SEED}` })
  expect(first.status).toBe(200)
  expect((await first.json()).version).toBe(2)

  const stale = await patchRecipe(row.code, { title: 'Stale write', expectedVersion: 1, params: { tempC: 60 } })
  expect(stale.status).toBe(409)
  expect(await stale.json()).toEqual({ error: 'version_conflict', currentVersion: 2 })

  const stored = await getRecipeAnyStatus(getDb(), row.code)
  expect(stored?.version).toBe(2)
  expect(stored?.title).toBe(`Merge Conflict First ${SEED}`)
  expect(stored?.params).toEqual({ doseG: 15, tempC: 92 })
})

test('PATCH with a matching expectedVersion writes and bumps the version', async () => {
  const row = await seed('Merge Match', { doseG: 15 })
  const res = await patchRecipe(row.code, { params: { tempC: 91 }, expectedVersion: 1 })
  expect(res.status).toBe(200)
  const updated = await res.json()
  expect(updated.version).toBe(2)
  expect(updated.params).toEqual({ doseG: 15, tempC: 91 })
})

test('PATCH dryRun returns before/after/changed and writes nothing', async () => {
  const row = await seed('Merge DryRun', { doseG: 15, tempC: 92 })
  const res = await patchRecipe(row.code, { params: { tempC: 70, grinder: null }, dryRun: true })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.dryRun).toBe(true)
  expect(body.before.version).toBe(1)
  expect(body.before.params).toEqual({ doseG: 15, tempC: 92 })
  expect(body.after.version).toBe(1)
  expect(body.after.params).toEqual({ doseG: 15, tempC: 70 })
  expect(body.changed).toEqual(['params.tempC'])

  const stored = await getRecipeAnyStatus(getDb(), row.code)
  expect(stored?.version).toBe(1)
  expect(stored?.params).toEqual({ doseG: 15, tempC: 92 })
})

test('PATCH dryRun with a stale expectedVersion → 409 and no write', async () => {
  const row = await seed('Merge DryRun Conflict', { tempC: 92 })
  const res = await patchRecipe(row.code, { params: { tempC: 70 }, dryRun: true, expectedVersion: 7 })
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'version_conflict', currentVersion: 1 })
})

test('PATCH with a malformed expectedVersion or dryRun → 400, nothing written', async () => {
  const row = await seed('Merge Bad Controls', { tempC: 92 })
  const badVersion = await patchRecipe(row.code, { title: 'x', expectedVersion: 'two' })
  expect(badVersion.status).toBe(400)
  const badDryRun = await patchRecipe(row.code, { title: 'x', dryRun: 'yes' })
  expect(badDryRun.status).toBe(400)
  const stored = await getRecipeAnyStatus(getDb(), row.code)
  expect(stored?.version).toBe(1)
})
