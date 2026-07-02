/**
 * feedback.owner.test.ts — ROB-654 feedback repair on the PUBLIC feedback route.
 *
 * Confirms two migration/route behaviours:
 *   1. feedback_link_bean trigger auto-fills feedback.bean_id from the parent recipe.
 *   2. owner_id is stamped from a resolved identity (X-BrewDial-Identity) and left
 *      NULL for anonymous callers (anonymous feedback stays legal).
 */
import { Hono } from 'hono'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '@brewdial/db'
import { feedback } from './feedback.js'
import { identityMiddleware } from '../middleware/identity.js'

function makeApp() {
  const app = new Hono()
  app.use('/api/*', identityMiddleware)
  app.route('/api/recipes', feedback)
  return app
}
const app = makeApp()

const SEED = randomUUID().replace(/-/g, '').slice(0, 8)
const recipeCode = `T-FBOWN-${SEED}`
const externalKey = `web_local_key_${SEED}_padding_16plus`
let beanId: string
let appUserId: string | undefined
const createdFeedbackIds: string[] = []

beforeAll(async () => {
  const db = getDb()
  const bean = await db
    .insertInto('beans')
    .values({ name: `FB Owner Bean ${SEED}` })
    .returning('id')
    .executeTakeFirstOrThrow()
  beanId = bean.id
  await db.insertInto('recipes').values({
    code: recipeCode,
    method: 'v60',
    title: 'FB Owner Recipe',
    status: 'active',
    bean_id: beanId,
    owner_id: null,
  }).execute()
})

afterAll(async () => {
  const db = getDb()
  if (createdFeedbackIds.length > 0) {
    await db.deleteFrom('feedback').where('id', 'in', createdFeedbackIds).execute()
  }
  await db.deleteFrom('recipes').where('code', '=', recipeCode).execute()
  await db.deleteFrom('beans').where('id', '=', beanId).execute()
  if (appUserId) {
    await db.deleteFrom('user_identities').where('app_user_id', '=', appUserId).execute()
    await db.deleteFrom('app_users').where('id', '=', appUserId).execute()
  }
  await closeDb()
})

test('POST feedback WITHOUT identity → owner_id null, bean_id auto-linked from recipe', async () => {
  const res = await app.request(`http://localhost/api/recipes/${recipeCode}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawComment: 'anon note' }),
  })
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(row['owner_id']).toBeNull()
  expect(row['bean_id']).toBe(beanId) // feedback_link_bean trigger
  createdFeedbackIds.push(row['id'] as string)
})

test('POST feedback WITH identity → owner_id stamped, bean_id still auto-linked', async () => {
  const res = await app.request(`http://localhost/api/recipes/${recipeCode}/feedback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-BrewDial-Identity': `web_local:${externalKey}`,
    },
    body: JSON.stringify({ rawComment: 'my note' }),
  })
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(typeof row['owner_id']).toBe('string')
  appUserId = row['owner_id'] as string
  expect(row['bean_id']).toBe(beanId)
  createdFeedbackIds.push(row['id'] as string)
})
