import { expect, test, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { agentAuth } from './agent-auth.js'

function makeApp() {
  const app = new Hono()
  app.use('/agent/*', agentAuth)
  app.get('/agent/x', (c) => c.json({ ok: true }))
  return app
}

let savedToken: string | undefined

beforeEach(() => {
  savedToken = process.env.AGENT_TOKEN
  process.env.AGENT_TOKEN = 'test-token'
})

afterEach(() => {
  if (savedToken === undefined) {
    delete process.env.AGENT_TOKEN
  } else {
    process.env.AGENT_TOKEN = savedToken
  }
})

test('no Authorization header → 401', async () => {
  const app = makeApp()
  const res = await app.request('/agent/x')
  expect(res.status).toBe(401)
  const body = await res.json()
  expect(body).toEqual({ ok: false, error: 'agent auth required' })
})

test('wrong token → 401', async () => {
  const app = makeApp()
  const res = await app.request('/agent/x', {
    headers: { Authorization: 'Bearer wrong-token' },
  })
  expect(res.status).toBe(401)
  const body = await res.json()
  expect(body).toEqual({ ok: false, error: 'agent auth required' })
})

test('correct Bearer token → 200', async () => {
  const app = makeApp()
  const res = await app.request('/agent/x', {
    headers: { Authorization: 'Bearer test-token' },
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({ ok: true })
})

test('AGENT_TOKEN unset → throws (fail closed)', async () => {
  delete process.env.AGENT_TOKEN
  const app = makeApp()
  // The middleware throws when AGENT_TOKEN is unset; Hono surfaces it as 500
  const res = await app.request('/agent/x', {
    headers: { Authorization: 'Bearer test-token' },
  })
  // Either 500 (Hono default error handler) is acceptable; the key property
  // is that the request is NOT allowed through (not 200)
  expect(res.status).not.toBe(200)
})
