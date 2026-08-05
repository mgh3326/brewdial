import { expect, test } from 'vitest'
import { Hono } from 'hono'
import { me } from './me.js'

const app = new Hono()
app.route('/api/me', me)

test('PUT /api/me/preferences has no public handler', async () => {
  const res = await app.request('/api/me/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ likes: ['저산미'], dislikes: [] }),
  })
  expect(res.status).toBe(404)
})
