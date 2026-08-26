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
  const testApp = makeApp()
  const res = await testApp.request('/agent/x')
  expect(res.status).toBe(401)
  const body = await res.json()
  expect(body).toEqual({ ok: false, error: 'agent auth required' })
})

test('wrong token → 401', async () => {
  const testApp = makeApp()
  const res = await testApp.request('/agent/x', {
    headers: { Authorization: 'Bearer wrong-token' },
  })
  expect(res.status).toBe(401)
  const body = await res.json()
  expect(body).toEqual({ ok: false, error: 'agent auth required' })
})

test('correct Bearer token → 200', async () => {
  const testApp = makeApp()
  const res = await testApp.request('/agent/x', {
    headers: { Authorization: 'Bearer test-token' },
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({ ok: true })
})

test('AGENT_TOKEN unset → 503 (fail closed, no stack trace)', async () => {
  delete process.env.AGENT_TOKEN
  const testApp = makeApp()
  // The middleware returns a clean 503 when AGENT_TOKEN is unset (no throw, no stderr stack trace).
  const res = await testApp.request('/agent/x', {
    headers: { Authorization: 'Bearer test-token' },
  })
  expect(res.status).toBe(503)
  const body = await res.json()
  expect(body).toEqual({ ok: false, error: 'agent auth not configured' })
})
