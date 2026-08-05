import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { closeDb, getDb } from '@brewdial/db'
import { feedback } from './feedback.js'

const app = new Hono()
app.route('/api/recipes', feedback)

const feedbackRecipeCode = `T-WRITELOCK-${randomUUID().replace(/-/g, '').slice(0, 8)}`

beforeAll(async () => {
  await getDb().insertInto('recipes').values({
    code: feedbackRecipeCode,
    method: 'v60',
    title: 'Write Lock Feedback Owner Recipe',
    status: 'active',
    owner_id: null,
  }).execute()
})

afterAll(async () => {
  await getDb().deleteFrom('recipes').where('code', '=', feedbackRecipeCode).execute()
  await closeDb()
})

test('POST feedback has no anonymous public handler', async () => {
  const res = await app.request(`/api/recipes/${feedbackRecipeCode}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawComment: 'anonymous probe' }),
  })
  expect(res.status).toBe(404)
})

test('POST feedback remains unavailable even with an identity header', async () => {
  const res = await app.request(`/api/recipes/${feedbackRecipeCode}/feedback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-BrewDial-Identity': 'web_local:test-identity-1234567890',
    },
    body: JSON.stringify({ rawComment: 'identity probe' }),
  })
  expect(res.status).toBe(404)
})
