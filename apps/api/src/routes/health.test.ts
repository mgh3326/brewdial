import { expect, test } from 'vitest'
import { app } from '../app.js'

test('GET /api/health returns ok', async () => {
  const res = await app.request('/api/health')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.service).toBe('brewdial-api')
})

test('GET /api/db/health reports db up', async () => {
  const res = await app.request('/api/db/health')
  expect(res.status).toBe(200)
  expect((await res.json()).db).toBe('up')
})
