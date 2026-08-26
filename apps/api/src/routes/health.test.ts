import { expect, test } from 'vitest'
import { request } from '../test/request.js'

test('GET /api/health returns ok', async () => {
  const res = await request('/api/health')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.service).toBe('brewdial-api')
})

test('GET /api/db/health reports db up', async () => {
  const res = await request('/api/db/health')
  expect(res.status).toBe(200)
  expect((await res.json()).db).toBe('up')
})
