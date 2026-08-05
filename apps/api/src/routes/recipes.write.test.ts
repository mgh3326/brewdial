import { expect, test } from 'vitest'
import { app } from '../app.js'

const LOCKED_WRITES = [
  { method: 'PUT', path: '/me/preferences', body: { likes: ['저산미'] } },
  { method: 'POST', path: '/recipes', body: { method: 'v60', title: 'anonymous probe' } },
  {
    method: 'POST',
    path: '/recipes/COF-LOCKED/feedback',
    body: { rawComment: 'anonymous probe' },
  },
] as const

test('anonymous public writes are removed through both app mounts', async () => {
  const observations: Array<{ prefix: string; route: string; status: number }> = []

  for (const prefix of ['/api', '']) {
    for (const route of LOCKED_WRITES) {
      const res = await app.request(`${prefix}${route.path}`, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(route.body),
      })
      observations.push({ prefix: prefix || '(none)', route: route.path, status: res.status })
      expect(res.status).toBe(404)
    }
  }

  expect(new Set(observations.map((o) => o.status)).size).toBe(1)
  console.log(`AC1/AC2 locked write statuses: ${JSON.stringify(observations)}`)
})
