import { Hono } from 'hono'
import { expect, test } from 'vitest'
import { feedback } from './feedback.js'

const app = new Hono()
app.route('/api/recipes', feedback)

test('POST feedback has no anonymous public handler', async () => {
  const res = await app.request('/api/recipes/COF-LOCKED/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawComment: 'anonymous probe' }),
  })
  expect(res.status).toBe(404)
})

test('POST feedback remains unavailable even with an identity header', async () => {
  const res = await app.request('/api/recipes/COF-LOCKED/feedback', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-BrewDial-Identity': 'web_local:test-identity-1234567890',
    },
    body: JSON.stringify({ rawComment: 'identity probe' }),
  })
  expect(res.status).toBe(404)
})
