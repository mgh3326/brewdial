import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { closeDb, getDb, insertAgentRecipe } from '@brewdial/db'
import { request } from '../test/request.js'

const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
let seededCode = ''

beforeAll(async () => {
  process.env.AGENT_TOKEN = 'test-token'
  const recipe = await insertAgentRecipe(getDb(), {
    method: 'v60',
    title: `Array Body Seed ${suffix}`,
  })
  seededCode = recipe.code
})

afterAll(async () => {
  const db = getDb()
  if (seededCode) await db.deleteFrom('recipes').where('code', '=', seededCode).execute()
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

for (const mount of ['/agent', '/api/agent']) {
  test(`PATCH ${mount}/recipes/:code with [] → 400 invalid body and preserves version`, async () => {
    const db = getDb()
    const before = await db
      .selectFrom('recipes')
      .select('version')
      .where('code', '=', seededCode)
      .executeTakeFirstOrThrow()

    const res = await request(agentReq(`${mount}/recipes/${seededCode}`, {
      method: 'PATCH',
      body: JSON.stringify([]),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid body' })

    const after = await db
      .selectFrom('recipes')
      .select('version')
      .where('code', '=', seededCode)
      .executeTakeFirstOrThrow()
    expect(after.version).toBe(before.version)
  })

  test(`POST ${mount}/feedback with [] → 400 invalid body`, async () => {
    const res = await request(agentReq(`${mount}/feedback`, {
      method: 'POST',
      body: JSON.stringify([]),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid body' })
  })

  test(`POST ${mount}/recipes with [] stays on the validator path`, async () => {
    const res = await request(agentReq(`${mount}/recipes`, {
      method: 'POST',
      body: JSON.stringify([]),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'validation failed',
      details: ['input must be an object'],
    })
  })
}
