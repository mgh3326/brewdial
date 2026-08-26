// ROB-642 C3: identityMiddleware must fail CLOSED (503) when a well-formed
// identity header is present but resolveAppUser throws (e.g. DB down). Garbage
// headers still fall through to anonymous; public GETs without a header are
// unaffected. vi.mock is hoisted above the static import.
import { Hono } from 'hono'
import { expect, test, vi } from 'vitest'

vi.mock('@brewdial/db', () => ({
  getDb: () => ({}),
  resolveAppUser: vi.fn().mockRejectedValue(new Error('db down')),
}))

const { identityMiddleware } = await import('./identity.js')

function appUnderTest() {
  const app = new Hono()
  app.use('*', identityMiddleware)
  app.get('/pub', (c) => c.json({ id: c.get('appUserId') ?? null }))
  return app
}

const VALID_KEY = 'toss_anon:failclosedtest_' + '0'.repeat(20)

test.skipIf(!!process.env.API_TEST_BASE_URL)('valid identity header + resolve throws → 503 fail-closed', async () => {
  const res = await appUnderTest().request('/pub', {
    headers: { 'X-BrewDial-Identity': VALID_KEY },
  })
  expect(res.status).toBe(503)
  const body = await res.json()
  expect(body['error']).toBe('identity temporarily unavailable')
})

test.skipIf(!!process.env.API_TEST_BASE_URL)('no header (public GET) → 200 anonymous, unaffected by fail-closed', async () => {
  const res = await appUnderTest().request('/pub')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body['id']).toBeNull()
})

test.skipIf(!!process.env.API_TEST_BASE_URL)('garbage header (bad provider / short key) → 200 anonymous, not 503', async () => {
  const res = await appUnderTest().request('/pub', {
    headers: { 'X-BrewDial-Identity': 'bogus:short' },
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body['id']).toBeNull()
})
