import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { closeDb, getDb } from '@brewdial/db'
import { request } from '../test/request.js'

const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
const recipeCode = `COF-0000${Date.now()}${Math.floor(Math.random() * 1_000_000)}`
const xbloomRecipeId = `8${Date.now()}${Math.floor(Math.random() * 1_000_000)}`
const brewIds = Array.from({ length: 5 }, (_, index) => `9${Date.now()}${Math.floor(Math.random() * 1_000_000)}${index}`)
let recipeInserted = false
let recipeLinkCreated = false
const insertedBrewIds = new Set<string>()

function curve(cupAtPourEnd: number, delayed = false): Array<[number, number]> {
  const points: Array<[number, number]> = [[0, 0], [220, cupAtPourEnd]]
  for (let second = 2; second <= 11; second += 1) {
    const cupG = delayed
      ? cupAtPourEnd + (second - 1) * 8
      : second === 2 ? 196 : second === 3 ? 199 : 200
    points.push([220, cupG])
  }
  if (delayed) points.push([220, 199], [220, 200])
  return points
}

function brew(id: string, brewedAt: string, cupAtPourEnd = 120, delayed = false) {
  return {
    xbloomBrewId: id, brewedAt, brewTimeSec: 180, recipeName: 'Invented API fixture', xbloomRecipeId,
    recipeSnapshot: { doseG: 18, grinderSize: 42, rpm: 80, cupType: 1, bypassEnabled: true, bypassVolumeMl: 100, bypassTemperatureC: 80, pours: [] },
    curve: curve(cupAtPourEnd, delayed)
  }
}

function agentReq(path: string, options?: RequestInit): Request {
  return new Request(`http://localhost${path}`, { headers: { 'content-type': 'application/json', authorization: 'Bearer test-token', ...(options?.headers as Record<string, string> ?? {}) }, ...options })
}

beforeAll(async () => {
  process.env.AGENT_TOKEN = 'test-token'
  const db = getDb()
  expect(await db.selectFrom('recipes').select('code').where('code', '=', recipeCode).execute(), 'fixture recipe code already exists').toEqual([])
  expect(await db.selectFrom('brews').select('xbloom_brew_id').where('xbloom_brew_id', 'in', brewIds).execute(), 'fixture brew id already exists').toEqual([])
  expect(await db.selectFrom('xbloom_recipe_links').select('xbloom_recipe_id').where('xbloom_recipe_id', '=', xbloomRecipeId).execute(), 'fixture recipe link already exists').toEqual([])
  await db.insertInto('recipes').values({ code: recipeCode, method: 'v60', title: `Brew fixture ${suffix}`, status: 'active', owner_id: null }).execute()
  recipeInserted = true
})

afterAll(async () => {
  const db = getDb()
  if (recipeLinkCreated) await db.deleteFrom('xbloom_recipe_links').where('xbloom_recipe_id', '=', xbloomRecipeId).execute()
  if (insertedBrewIds.size > 0) await db.deleteFrom('brews').where('xbloom_brew_id', 'in', [...insertedBrewIds]).execute()
  if (recipeInserted) await db.deleteFrom('recipes').where('code', '=', recipeCode).execute()
  await closeDb()
})

test('agent auth is required on every new brews and recipe-link route', async () => {
  const cases: Array<[string, string, unknown?]> = [
    ['POST', '/api/agent/brews', { brews: [brew(brewIds[0], '2026-01-01T00:00:00.000Z')] }],
    ['POST', '/api/agent/xbloom/brew-records', { records: [{ tableId: '1' }] }],
    ['GET', '/api/agent/brews'], ['GET', `/api/agent/brews/${brewIds[0]}`],
    ['PUT', `/api/agent/xbloom-recipe-links/${xbloomRecipeId}`, { recipeCode }], ['GET', '/api/agent/xbloom-recipe-links']
  ]
  for (const [method, path, body] of cases) {
    const response = await request(new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    expect(response.status, `${method} ${path}`).toBe(401)
  }
})

test('POST /agent/xbloom/brew-records strips raw identifiers, skips bad records, and is idempotent', async () => {
  const rawId = `7${Date.now()}${Math.floor(Math.random() * 1_000_000)}`
  const marker = 'fixture-only-device-marker'
  const raw = {
    tableId: rawId,
    createTimeStamp: Date.UTC(2026, 2, 3, 4, 5, 6),
    brewTime: 180,
    recipeName: 'Synthetic hand-made fixture',
    recipeVo: {
      tableId: `${rawId}1`, dose: 18, grinderSize: 42, rpm: 80, cupType: 2,
      isEnableBypassWater: 1, bypassVolume: 100, bypassTemp: 80, pourList: []
    },
    lineChartData: [[0, 0], [220, 120], [220, 196], [220, 200]],
    deviceId: marker,
    machineId: marker,
    device_id: marker,
    memberUsedRecipesId: marker,
    pid: marker,
    mac: marker,
    memberId: marker,
    accountId: marker
  }
  const records = [raw, { ...raw, tableId: `${rawId}2`, brewTime: 0 }, { ...raw, tableId: `${rawId}3`, lineChartData: '{broken' }]
  const first = await request(agentReq('/api/agent/xbloom/brew-records', { method: 'POST', body: JSON.stringify({ records }) }))
  const firstBody = await first.json() as { inserted: string[]; duplicate: string[]; skipped: Array<{ index: number; reason: string }> }
  expect(first.status, JSON.stringify(firstBody)).toBe(200)
  firstBody.inserted.forEach((id) => insertedBrewIds.add(id))
  expect(firstBody.inserted).toEqual([rawId])
  expect(firstBody.duplicate).toEqual([])
  expect(firstBody.skipped).toEqual([
    { index: 1, reason: 'broken_run' },
    { index: 2, reason: 'lineChartData must be valid JSON' }
  ])
  const firstJson = JSON.stringify(firstBody)
  expect(firstJson).not.toContain(marker)
  expect(firstJson).not.toContain('deviceId')
  expect(firstJson).not.toContain('machineId')
  expect(firstJson).not.toContain('memberUsedRecipesId')
  expect(firstJson).not.toContain('accountId')

  const stored = await getDb().selectFrom('brews').selectAll().where('xbloom_brew_id', '=', rawId).executeTakeFirstOrThrow()
  expect(JSON.stringify(stored)).not.toContain(marker)
  expect(stored['recipe_name']).toBe('Synthetic hand-made fixture')
  const second = await request(agentReq('/api/agent/xbloom/brew-records', { method: 'POST', body: JSON.stringify({ records: [raw] }) }))
  expect(await second.json()).toEqual({ inserted: [], duplicate: [rawId], skipped: [] })

  for (const records of [[], Array.from({ length: 201 }, (_, index) => ({ ...raw, tableId: `${rawId}${index}` }))]) {
    const response = await request(agentReq('/api/agent/xbloom/brew-records', { method: 'POST', body: JSON.stringify({ records }) }))
    expect(response.status).toBe(400)
  }
})

test('POST /agent/brews inserts, preserves duplicates unchanged, rejects identifiers, and resolves a later link on read', async () => {
  const timestamps = [0, 1, 2, 3, 4].map((offset) => new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString())
  const baseline = brewIds.slice(0, 4).map((id, index) => brew(id, timestamps[index]!))
  const first = await request(agentReq('/api/agent/brews', { method: 'POST', body: JSON.stringify({ brews: baseline }) }))
  const firstBody = await first.json() as { inserted: string[]; duplicate: string[] }
  firstBody.inserted.forEach((id) => insertedBrewIds.add(id))
  expect(first.status).toBe(200)
  expect(firstBody).toEqual({ inserted: brewIds.slice(0, 4), duplicate: [] })

  const changedDuplicate = { ...baseline[0]!, recipeName: 'must remain unchanged', brewTimeSec: 999 }
  const second = await request(agentReq('/api/agent/brews', { method: 'POST', body: JSON.stringify({ brews: [changedDuplicate, brew(brewIds[4]!, timestamps[4]!, 117.5, true)] }) }))
  const secondBody = await second.json() as { inserted: string[]; duplicate: string[] }
  secondBody.inserted.forEach((id) => insertedBrewIds.add(id))
  expect(second.status).toBe(200)
  expect(secondBody).toEqual({ inserted: [brewIds[4]], duplicate: [brewIds[0]] })

  const invalid = await request(agentReq('/api/agent/brews', { method: 'POST', body: JSON.stringify({ brews: [{ ...baseline[0], xbloomBrewId: '99999999', mac: 'not-allowed' }] }) }))
  expect(invalid.status).toBe(400)
  const badText = await request(agentReq('/api/agent/brews', { method: 'POST', body: JSON.stringify({ brews: [{ ...baseline[0], xbloomBrewId: '99999998', recipeName: 'bad\u0000text' }] }) }))
  expect(badText.status).toBe(400)
  const badGet = await request(agentReq('/api/agent/brews?limit=0'))
  expect(badGet.status).toBe(400)

  const link = await request(agentReq(`/api/agent/xbloom-recipe-links/${xbloomRecipeId}`, { method: 'PUT', body: JSON.stringify({ recipeCode }) }))
  recipeLinkCreated = (await getDb().selectFrom('xbloom_recipe_links').select('xbloom_recipe_id').where('xbloom_recipe_id', '=', xbloomRecipeId).execute()).length > 0
  expect(link.status).toBe(200)
  const links = await request(agentReq('/api/agent/xbloom-recipe-links'))
  expect((await links.json() as Array<Record<string, unknown>>).some((item) => item['xbloomRecipeId'] === xbloomRecipeId && item['recipeCode'] === recipeCode)).toBe(true)

  const original = await request(agentReq(`/api/agent/brews/${brewIds[0]}`))
  const brewRow = await original.json() as Record<string, any>
  expect(brewRow.recipeName).toBe('Invented API fixture')
  expect(brewRow.brewTimeSec).toBe(180)
  expect(brewRow.totalWaterMl).toBe(220)
  expect(brewRow.finalCupG).toBe(200)
  expect(brewRow.retentionG).toBe(20)
  expect(brewRow.linkedRecipe).toMatchObject({ recipeCode, title: `Brew fixture ${suffix}`, currentVersion: 1 })
  expect(brewRow.anomalyHint).toEqual({ status: 'insufficient_baseline', baselineCount: 0 })
  expect(brewRow.curve).toHaveLength(baseline[0]!.curve.length)
  expect(brewRow.recipeName).not.toBe(changedDuplicate.recipeName)

  const normal = await request(agentReq(`/api/agent/brews/${brewIds[3]}`))
  expect((await normal.json() as Record<string, any>).anomalyHint.status).toBe('normal')

  const anomaly = await request(agentReq(`/api/agent/brews/${brewIds[4]}`))
  const anomalyRow = await anomaly.json() as Record<string, any>
  expect(anomalyRow.anomalyHint.status).toBe('unusual')
  expect(anomalyRow.anomalyHint.metrics.filter((metric: Record<string, unknown>) => metric['flagged']).map((metric: Record<string, unknown>) => metric['metric'])).toEqual(['drawdownSec', 'cupAtPourEndG'])
  const list = await request(agentReq(`/api/agent/brews?limit=5&recipeCode=${recipeCode}`))
  const listRows = await list.json() as Array<Record<string, unknown>>
  expect(listRows).toHaveLength(5)
  expect(listRows[0]).not.toHaveProperty('curve')
})

test('recipe links return 404 for missing recipes and accept only recipeCode', async () => {
  const missing = await request(agentReq(`/api/agent/xbloom-recipe-links/${xbloomRecipeId}`, { method: 'PUT', body: JSON.stringify({ recipeCode: 'COF-9999999999999999' }) }))
  expect(missing.status).toBe(404)
  const extra = await request(agentReq(`/api/agent/xbloom-recipe-links/${xbloomRecipeId}`, { method: 'PUT', body: JSON.stringify({ recipeCode, extra: true }) }))
  expect(extra.status).toBe(400)
})
