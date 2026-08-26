import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { request } from '../test/request.js'
import { closeDb, getDb } from '@brewdial/db'

const seed = randomUUID().replace(/-/g, '').slice(0, 8)
const beanId = randomUUID()
const recipeCode = `T-WRITELOCK-${seed}`
const externalKey = `me-write-lock-${seed}-${'0'.repeat(20)}`
const identity = `toss_anon:${externalKey}`

beforeAll(async () => {
  await getDb().insertInto('beans').values({ id: beanId, name: `Write Lock Bean ${seed}` }).execute()
  await getDb().insertInto('recipes').values({
    code: recipeCode,
    method: 'v60',
    title: 'Write Lock Recipe',
    status: 'active',
    owner_id: null,
  }).execute()
})

afterAll(async () => {
  const db = getDb()
  await db.deleteFrom('recipes').where('code', '=', recipeCode).execute()
  await db.deleteFrom('beans').where('id', '=', beanId).execute()

  const userIdentity = await db
    .selectFrom('user_identities')
    .select(['app_user_id'])
    .where('provider', '=', 'toss_anon')
    .where('external_key', '=', externalKey)
    .executeTakeFirst()
  if (userIdentity) {
    await db.deleteFrom('user_identities').where('app_user_id', '=', userIdentity.app_user_id).execute()
    await db.deleteFrom('app_users').where('id', '=', userIdentity.app_user_id).execute()
  }
  await closeDb()
})

test('identity-scoped visitor storage writes and collections remain available', async () => {
  const headers = { 'content-type': 'application/json', 'X-BrewDial-Identity': identity }
  const savedRecipe = await request('/api/me/saved-recipes', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: recipeCode }),
  })
  const savedBean = await request('/api/me/saved-beans', {
    method: 'POST',
    headers,
    body: JSON.stringify({ beanId }),
  })
  const gear = await request('/api/me/gear', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ kind: 'grinder', label: `Write Lock Grinder ${seed}` }),
  })
  const calibration = await request('/api/me/calibration', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      fromLabel: `Write Lock From ${seed}`,
      toLabel: `Write Lock To ${seed}`,
      samples: [{ fromClicks: 20, toClicks: 15 }],
    }),
  })
  const collections = await request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': identity },
  })

  const statuses = {
    savedRecipe: savedRecipe.status,
    savedBean: savedBean.status,
    gear: gear.status,
    calibration: calibration.status,
    collections: collections.status,
  }
  expect(statuses).toEqual({ savedRecipe: 201, savedBean: 201, gear: 200, calibration: 200, collections: 200 })
  console.log(`AC4 identity write statuses: ${JSON.stringify(statuses)}`)
})
