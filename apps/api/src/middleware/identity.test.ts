import { Hono } from 'hono'
import { expect, test } from 'vitest'
import { identityMiddleware, requireIdentity } from './identity.js'

function appUnderTest() {
  const app = new Hono()
  app.use('*', identityMiddleware)
  app.get('/pub', (c) => c.json({ id: c.get('appUserId') ?? null }))
  app.get('/me/x', requireIdentity, (c) => c.json({ id: c.get('appUserId') }))
  return app
}
const KEY = 'toss_anon:idmwtestkey_' + '0'.repeat(20)

test('resolves a valid identity header to an app_user id', async () => {
  const res = await appUnderTest().request('/pub', { headers: { 'X-BrewDial-Identity': KEY } })
  const body = await res.json()
  expect(typeof body.id).toBe('string'); expect(body.id.length).toBeGreaterThan(10)
})
test('/me route without identity → 401', async () => {
  const res = await appUnderTest().request('/me/x')
  expect(res.status).toBe(401)
})
test('malformed provider → 401 on /me', async () => {
  const res = await appUnderTest().request('/me/x', { headers: { 'X-BrewDial-Identity': 'bogus:short' } })
  expect(res.status).toBe(401)
})
