import { request } from '../test/request.js'
import { expect, test } from 'vitest'

test('PUT /api/me/preferences has no public handler', async () => {
  const res = await request('/api/me/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ likes: ['저산미'], dislikes: [] }),
  })
  expect(res.status).toBe(404)
})
