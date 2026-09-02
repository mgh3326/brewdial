import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { closeDb, getDb } from '@brewdial/db'
import { request } from '../test/request.js'

// This stays black-box by using the common request helper. Setting
// API_TEST_BASE_URL directs the same assertions at a locally hosted API, which
// is the contract oracle for the API-Kotlin follow-up without changing api-kt.
const SEED = randomUUID().replace(/-/g, '').slice(0, 8)
const goodBeanId = randomUUID()
const nearBeanId = randomUUID()
const noRecipeBeanId = randomUUID()
const privateRecipeBeanId = randomUUID()
const unattributedBeanId = randomUUID()
const publicRecipeCode = `T-PICK-PUBLIC-${SEED}`
const privateRecipeCode = `T-PICK-PRIVATE-${SEED}`
let privateOwnerId = ''

beforeAll(async () => {
  const db = getDb()
  privateOwnerId = (await db.insertInto('app_users').defaultValues().returning('id').executeTakeFirstOrThrow()).id
  await db.insertInto('beans').values([
    // Same top band, but Good's score is 1 and Near's is .9. Seed 6 falls in
    // the narrow range that weighted selection sends to Good while a uniform
    // pick would send to Near; that makes the weighting mutant observable.
    { id: goodBeanId, name: `A Pick Good ${SEED}`, acidity: 1, body: 1, roast_level_ord: 1, decaf: true, attrs_source: 'manual' },
    { id: nearBeanId, name: `B Pick Near ${SEED}`, acidity: 2, body: 1, roast_level_ord: 1, decaf: true, attrs_source: 'manual' },
    { id: noRecipeBeanId, name: `C Pick No Recipe ${SEED}`, acidity: 1, body: 1, roast_level_ord: 1, decaf: false, attrs_source: 'manual' },
    { id: privateRecipeBeanId, name: `D Pick Private ${SEED}`, acidity: 5, body: 5, roast_level_ord: 5, decaf: false, attrs_source: 'manual' },
    { id: unattributedBeanId, name: `E Pick Free Text ${SEED}`, decaf: true },
  ]).execute()

  await db.transaction().execute(async (trx) => {
    // The same guarded path permits a fixture that verifies the AI recipe flag.
    await sql`select set_config('bd.owner_write_ok', 'on', true)`.execute(trx)
    await trx.insertInto('recipes').values({
      code: publicRecipeCode,
      method: 'v60',
      title: `Pick public recipe ${SEED}`,
      bean_id: goodBeanId,
      status: 'active',
      owner_id: null,
      created_by: 'agent',
    }).execute()
  })

  // The DB guard permits owner-scoped fixtures only inside this transaction.
  await db.transaction().execute(async (trx) => {
    await sql`select set_config('bd.owner_write_ok', 'on', true)`.execute(trx)
    await trx.insertInto('recipes').values({
      code: privateRecipeCode,
      method: 'v60',
      title: `Pick private recipe ${SEED}`,
      bean_id: privateRecipeBeanId,
      status: 'active',
      owner_id: privateOwnerId,
    }).execute()
  })
})

afterAll(async () => {
  const db = getDb()
  await db.deleteFrom('recipes').where('code', 'in', [publicRecipeCode, privateRecipeCode]).execute()
  await db.deleteFrom('beans').where('id', 'in', [goodBeanId, nearBeanId, noRecipeBeanId, privateRecipeBeanId, unattributedBeanId]).execute()
  if (privateOwnerId) await db.deleteFrom('app_users').where('id', '=', privateOwnerId).execute()
  await closeDb()
})

test('GET /api/recommendations/pick returns a seeded, weighted pick with public recipe only', async () => {
  const path = '/api/recommendations/pick?acidity=1&body=1&roast=1&decaf=true&seed=6'
  const res = await request(path)
  expect(res.status).toBe(200)
  const body: any = await res.json()
  expect(body.bean.id).toBe(goodBeanId)
  expect(body.band).toBe('great')
  expect(body.axes).toEqual(expect.any(Array))
  expect(body.why).toEqual(expect.any(String))
  expect(body.recipe).toEqual({ code: publicRecipeCode, title: `Pick public recipe ${SEED}`, createdBy: 'agent' })
  expect(body.tasteTarget).toMatchObject({ acidity: 1, body: 1, roast: 1 })

  // The unprefixed mini-app route and canonical /api route share this handler.
  const miniAppRes = await request('/recommendations/pick?acidity=1&body=1&roast=1&decaf=true&seed=6')
  expect(miniAppRes.status).toBe(200)
  expect((await miniAppRes.json()).bean.id).toBe(goodBeanId)
})

test('a fixed seed returns the same bean twice', async () => {
  const path = '/api/recommendations/pick?acidity=1&body=1&roast=1&decaf=true&seed=6'
  const [first, second] = await Promise.all([request(path), request(path)])
  expect((await first.json()).bean.id).toBe((await second.json()).bean.id)
})

test('rejects out-of-range and non-integer query parameters', async () => {
  for (const path of [
    '/api/recommendations/pick?acidity=9&body=1&roast=1',
    '/api/recommendations/pick?acidity=1&body=1&roast=abc',
  ]) {
    const res = await request(path)
    expect(res.status).toBe(400)
    const body: any = await res.json()
    expect(body.error).toBe('validation failed')
    expect(body.details).toEqual(expect.any(Array))
  }
})

test('does not attach missing or private recipes', async () => {
  const noRecipe = await request('/api/recommendations/pick?acidity=1&body=1&roast=1&decaf=false&seed=6')
  expect(noRecipe.status).toBe(200)
  const noRecipeBody: any = await noRecipe.json()
  expect(noRecipeBody.bean.id).toBe(noRecipeBeanId)
  expect(noRecipeBody.recipe).toBeNull()

  const privateOnly = await request('/api/recommendations/pick?acidity=5&body=5&roast=5&decaf=false&seed=6')
  expect(privateOnly.status).toBe(200)
  const privateOnlyBody: any = await privateOnly.json()
  expect(privateOnlyBody.bean.id).toBe(privateRecipeBeanId)
  expect(privateOnlyBody.recipe).toBeNull()
})

test('returns no_attributed_beans when only free-text beans match the filter', async () => {
  const db = getDb()
  await db.deleteFrom('recipes').where('code', '=', publicRecipeCode).execute()
  await db.deleteFrom('beans').where('id', 'in', [goodBeanId, nearBeanId]).execute()

  const res = await request('/api/recommendations/pick?acidity=1&body=1&roast=1&decaf=true&seed=6')
  expect(res.status).toBe(200)
  await expect(res.json()).resolves.toEqual({ bean: null, reason: 'no_attributed_beans' })
})
