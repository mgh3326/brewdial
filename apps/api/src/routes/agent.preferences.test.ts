import { Hono } from 'hono'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { closeDb, getDb, getGlobalPreference, setGlobalPreference } from '@brewdial/db'
import { agentAuth } from '../middleware/agent-auth.js'
import { agentRouter } from './agent.js'

function makeApp() {
  const app = new Hono()
  app.use('/api/agent/*', agentAuth)
  app.route('/api/agent', agentRouter)
  return app
}

const app = makeApp()
const AUTH = { authorization: 'Bearer test-token', 'content-type': 'application/json' }
const previousToken = process.env.AGENT_TOKEN

beforeAll(() => {
  process.env.AGENT_TOKEN = 'test-token'
})

afterAll(async () => {
  await closeDb()
  if (previousToken === undefined) delete process.env.AGENT_TOKEN
  else process.env.AGENT_TOKEN = previousToken
})

test('POST /api/agent/preferences/global with token → 200 and persists the value', async () => {
  const previous = await getGlobalPreference(getDb())
  try {
    const res = await app.request('/api/agent/preferences/global', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ likes: ['저산미', '고소함'], dislikes: ['고산미'] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.likes).toEqual(['저산미', '고소함'])
    expect(body.dislikes).toEqual(['고산미'])

    const row = await getGlobalPreference(getDb())
    expect(row?.likes).toEqual(['저산미', '고소함'])
    expect(row?.dislikes).toEqual(['고산미'])
  } finally {
    await setGlobalPreference(getDb(), { likes: previous?.likes ?? [], dislikes: previous?.dislikes ?? [] })
  }
})

test('POST /api/agent/preferences/global without token → 401', async () => {
  const res = await app.request('/api/agent/preferences/global', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ likes: ['저산미'] }),
  })
  expect(res.status).toBe(401)
})

test('POST /api/agent/preferences/global with an unknown tag → 400', async () => {
  const res = await app.request('/api/agent/preferences/global', {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({ likes: ['초코비'] }),
  })
  expect(res.status).toBe(400)
})
