import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { closeDb, getDb, resolveAppUser } from '@brewdial/db'
import { request } from '../test/request.js'

const REMOTE_API = Boolean(process.env.API_TEST_BASE_URL)
const SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)
const DIGITS = randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '1')

const ownerIdentity = `toss_anon:rob1341_owner_${SUFFIX}_${'0'.repeat(20)}`
const otherIdentity = `toss_anon:rob1341_other_${SUFFIX}_${'0'.repeat(20)}`
const recipeLimitIdentity = `toss_anon:rob1341_recipe_limit_${SUFFIX}_${'0'.repeat(20)}`
const feedbackLimitIdentity = `toss_anon:rob1341_feedback_limit_${SUFFIX}_${'0'.repeat(20)}`

const beanId = randomUUID()
const publicRecipeCode = `COF-${DIGITS}`
const feedbackRecipeCode = `COF-${DIGITS}2`
const createdRecipeCodes: string[] = []
const createdFeedbackIds: string[] = []

let ownerId = ''
let otherUserId = ''
let feedbackLimitUserId = ''

const jsonHeaders = (identity: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'X-BrewDial-Identity': identity,
})

async function postRecipe(identity: string, title: string): Promise<Record<string, unknown>> {
  const res = await request('/api/me/recipes', {
    method: 'POST',
    headers: jsonHeaders(identity),
    body: JSON.stringify({
      method: 'v60',
      title,
      params: { doseG: 20, waterG: 320, ratio: '1:16' },
      steps: [{ note: 'Bloom', atSec: 0, waterG: 40 }],
    }),
  })
  expect(res.status).toBe(201)
  const row = await res.json() as Record<string, unknown>
  expect(typeof row.code).toBe('string')
  createdRecipeCodes.push(row.code as string)
  return row
}

beforeAll(async () => {
  if (REMOTE_API) return

  const db = getDb()
  ownerId = await resolveAppUser(db, 'toss_anon', ownerIdentity.slice('toss_anon:'.length))
  otherUserId = await resolveAppUser(db, 'toss_anon', otherIdentity.slice('toss_anon:'.length))
  feedbackLimitUserId = await resolveAppUser(
    db,
    'toss_anon',
    feedbackLimitIdentity.slice('toss_anon:'.length),
  )

  await db.insertInto('beans').values({ id: beanId, name: `ROB-1341 Bean ${SUFFIX}` }).execute()
  await db.insertInto('recipes').values([
    {
      code: publicRecipeCode,
      method: 'v60',
      title: `ROB-1341 Public Recipe ${SUFFIX}`,
      status: 'active',
      bean_id: beanId,
      owner_id: null,
    },
    {
      code: feedbackRecipeCode,
      method: 'v60',
      title: `ROB-1341 Feedback Recipe ${SUFFIX}`,
      status: 'active',
      owner_id: null,
    },
  ]).execute()

  // Seed the feedback quota directly in the database. The route's 101st write
  // must be rejected by a DB aggregate, not an in-memory test counter.
  const seeded = await db
    .insertInto('feedback')
    .values(Array.from({ length: 100 }, (_, i) => ({
      recipe_code: feedbackRecipeCode,
      owner_id: feedbackLimitUserId,
      raw_comment: `ROB-1341 quota seed ${i}`,
      source: 'web' as const,
    })))
    .returning('id')
    .execute()
  createdFeedbackIds.push(...seeded.map((row) => row.id as string))
})

afterAll(async () => {
  if (REMOTE_API) return

  const db = getDb()
  if (createdFeedbackIds.length > 0) {
    await db.deleteFrom('feedback').where('id', 'in', createdFeedbackIds).execute()
  }
  const recipeCodes = [publicRecipeCode, feedbackRecipeCode, ...createdRecipeCodes]
  await db.deleteFrom('recipes').where('code', 'in', recipeCodes).execute()
  await db.deleteFrom('beans').where('id', '=', beanId).execute()
  await closeDb()
})

test('new identity-scoped write routes require an identity header', async () => {
  const requests: Array<[string, RequestInit]> = [
    ['/api/me/recipes', { method: 'POST', body: JSON.stringify({ method: 'v60', title: 'missing identity' }) }],
    ['/api/me/recipes/COF-9999', { method: 'PATCH', body: JSON.stringify({ title: 'missing identity' }) }],
    ['/api/me/recipes/COF-9999', { method: 'DELETE' }],
    ['/api/me/recipes/COF-9999/feedback', { method: 'POST', body: JSON.stringify({ rawComment: 'missing identity' }) }],
  ]

  for (const [path, init] of requests) {
    const res = await request(path, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status, path).toBe(401)
  }
})

test.skipIf(REMOTE_API)('POST /me/recipes stamps a private owner and returns code', async () => {
  const row = await postRecipe(ownerIdentity, `ROB-1341 owned ${SUFFIX}`)
  expect(row.owner_id).toBe(ownerId)
  expect(row.created_by).toBe('manual')
  expect(row.is_official).toBe(false)
  expect(row.status).toBe('active')
})

test.skipIf(REMOTE_API)('owner can PATCH a recipe, while protected fields stay server-controlled', async () => {
  const row = await postRecipe(ownerIdentity, `ROB-1341 patch ${SUFFIX}`)
  const code = row.code as string
  const res = await request(`/api/me/recipes/${code}`, {
    method: 'PATCH',
    headers: jsonHeaders(ownerIdentity),
    body: JSON.stringify({
      title: 'ROB-1341 patched title',
      ownerId: otherUserId,
      createdBy: 'agent',
      isOfficial: true,
    }),
  })
  expect(res.status).toBe(200)
  const patched = await res.json() as Record<string, unknown>
  expect(patched.title).toBe('ROB-1341 patched title')
  expect(patched.version).toBe(2)
  expect(patched.owner_id).toBe(ownerId)
  expect(patched.created_by).toBe('manual')
  expect(patched.is_official).toBe(false)
})

test.skipIf(REMOTE_API)('non-owner PATCH/DELETE and missing resources are all 404', async () => {
  const row = await postRecipe(ownerIdentity, `ROB-1341 private ${SUFFIX}`)
  const code = row.code as string

  const patchRes = await request(`/api/me/recipes/${code}`, {
    method: 'PATCH',
    headers: jsonHeaders(otherIdentity),
    body: JSON.stringify({ title: 'should not update' }),
  })
  expect(patchRes.status).toBe(404)

  const deleteRes = await request(`/api/me/recipes/${code}`, {
    method: 'DELETE',
    headers: jsonHeaders(otherIdentity),
  })
  expect(deleteRes.status).toBe(404)

  const missingPatch = await request('/api/me/recipes/COF-99999999', {
    method: 'PATCH',
    headers: jsonHeaders(otherIdentity),
    body: JSON.stringify({ title: 'missing' }),
  })
  expect(missingPatch.status).toBe(404)
  const missingDelete = await request('/api/me/recipes/COF-99999998', {
    method: 'DELETE',
    headers: jsonHeaders(otherIdentity),
  })
  expect(missingDelete.status).toBe(404)
})

test.skipIf(REMOTE_API)('DELETE archives a recipe and archived recipes are absent from myRecipes', async () => {
  const row = await postRecipe(ownerIdentity, `ROB-1341 archive ${SUFFIX}`)
  const code = row.code as string
  const res = await request(`/api/me/recipes/${code}`, {
    method: 'DELETE',
    headers: jsonHeaders(ownerIdentity),
  })
  expect(res.status).toBe(200)
  const archived = await res.json() as Record<string, unknown>
  expect(archived.status).toBe('archived')

  const collections = await request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': ownerIdentity },
  })
  expect(collections.status).toBe(200)
  const body = await collections.json() as { myRecipes: string[] }
  expect(body.myRecipes).not.toContain(code)
})

test.skipIf(REMOTE_API)('private recipes stay out of public recipes and do not bump bean recipe_count', async () => {
  const beforeRes = await request(`/api/beans/${beanId}`)
  expect(beforeRes.status).toBe(200)
  const before = await beforeRes.json() as Record<string, unknown>

  const row = await request('/api/me/recipes', {
    method: 'POST',
    headers: jsonHeaders(ownerIdentity),
    body: JSON.stringify({
      method: 'v60',
      title: `ROB-1341 bean privacy ${SUFFIX}`,
      beanId,
    }),
  })
  expect(row.status).toBe(201)
  const created = await row.json() as Record<string, unknown>
  createdRecipeCodes.push(created.code as string)

  const publicList = await request('/api/recipes?limit=100')
  expect(publicList.status).toBe(200)
  const rows = await publicList.json() as Array<Record<string, unknown>>
  expect(rows.some((r) => r.code === created.code)).toBe(false)

  const afterRes = await request(`/api/beans/${beanId}`)
  expect(afterRes.status).toBe(200)
  const after = await afterRes.json() as Record<string, unknown>
  expect(after.recipe_count).toBe(before.recipe_count)
})

test.skipIf(REMOTE_API)('feedback can target a visible recipe, is owned by the caller, and stays private', async () => {
  const res = await request(`/api/me/recipes/${publicRecipeCode}/feedback`, {
    method: 'POST',
    headers: jsonHeaders(ownerIdentity),
    body: JSON.stringify({
      rawComment: 'ROB-1341 private feedback',
      source: 'agent',
      ownerId: otherUserId,
    }),
  })
  expect(res.status).toBe(201)
  const row = await res.json() as Record<string, unknown>
  createdFeedbackIds.push(row.id as string)
  expect(row.recipe_code).toBe(publicRecipeCode)
  expect(row.owner_id).toBe(ownerId)
  expect(row.source).toBe('web')

  const publicList = await request(`/api/recipes/${publicRecipeCode}/feedback`)
  expect(publicList.status).toBe(200)
  const publicRows = await publicList.json() as Array<Record<string, unknown>>
  expect(publicRows.some((r) => r.id === row.id)).toBe(false)

  const ownList = await request(`/api/recipes/${publicRecipeCode}/feedback`, {
    headers: { 'X-BrewDial-Identity': ownerIdentity },
  })
  expect(ownList.status).toBe(200)
  const ownRows = await ownList.json() as Array<Record<string, unknown>>
  expect(ownRows.some((r) => r.id === row.id)).toBe(true)
})

test.skipIf(REMOTE_API)('feedback cannot be written to another identity-owned recipe', async () => {
  const row = await postRecipe(ownerIdentity, `ROB-1341 feedback visibility ${SUFFIX}`)
  const res = await request(`/api/me/recipes/${row.code as string}/feedback`, {
    method: 'POST',
    headers: jsonHeaders(otherIdentity),
    body: JSON.stringify({ rawComment: 'must be hidden' }),
  })
  expect(res.status).toBe(404)
})

test.skipIf(REMOTE_API)('the 21st recipe in one UTC day is rejected with 429', async () => {
  for (let i = 0; i < 20; i += 1) {
    await postRecipe(recipeLimitIdentity, `ROB-1341 recipe quota ${i}`)
  }
  const res = await request('/api/me/recipes', {
    method: 'POST',
    headers: jsonHeaders(recipeLimitIdentity),
    body: JSON.stringify({ method: 'v60', title: 'ROB-1341 recipe quota 21' }),
  })
  expect(res.status).toBe(429)
})

test.skipIf(REMOTE_API)('the 101st feedback in one UTC day is rejected with 429', async () => {
  const res = await request(`/api/me/recipes/${feedbackRecipeCode}/feedback`, {
    method: 'POST',
    headers: jsonHeaders(feedbackLimitIdentity),
    body: JSON.stringify({ rawComment: 'ROB-1341 feedback quota 101' }),
  })
  expect(res.status).toBe(429)
})
