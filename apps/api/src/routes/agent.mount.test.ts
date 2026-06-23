/**
 * agent.mount.test.ts — Task 6 smoke tests
 *
 * Exercises the FULLY MOUNTED app (imported from app.ts) to confirm:
 *   1. Agent routes are gated by agentAuth (/api/agent/* → 401 without token, 2xx with token).
 *   2. M3 public routes still work through the mounted app.
 *   3. No path collisions between /api/agent/* and /api/recipes etc.
 */

import { afterAll, beforeAll, expect, test } from 'vitest'
import { app } from '../app.js'
import { getDb, closeDb } from '@brewdial/db'
import { randomUUID } from 'node:crypto'

const SEED_SUFFIX = randomUUID().replace(/-/g, '').slice(0, 8)
const createdCodes: string[] = []

beforeAll(async () => {
  // agentAuth reads AGENT_TOKEN from env.
  process.env.AGENT_TOKEN = 'test-token'
})

afterAll(async () => {
  const db = getDb()
  if (createdCodes.length > 0) {
    await db.deleteFrom('recipes').where('code', 'in', createdCodes).execute()
  }
  await closeDb()
})

// ─── Agent auth gate ──────────────────────────────────────────────────────────

test('POST /api/agent/recipes without token → 401', async () => {
  const res = await app.request('/api/agent/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'v60', title: `Mount Smoke No-Auth ${SEED_SUFFIX}` }),
  })
  expect(res.status).toBe(401)
})

test('POST /api/agent/recipes with Bearer test-token → 201', async () => {
  const res = await app.request('/api/agent/recipes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer test-token',
    },
    body: JSON.stringify({ method: 'v60', title: `Mount Smoke Auth ${SEED_SUFFIX}` }),
  })
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(typeof row['code']).toBe('string')
  expect(row['created_by']).toBe('agent')
  createdCodes.push(row['code'] as string)
})

test('GET /api/agent/preferences/global with token → 200', async () => {
  const res = await app.request('/api/agent/preferences/global', {
    headers: { 'authorization': 'Bearer test-token' },
  })
  expect(res.status).toBe(200)
})

// ─── M3 public routes intact ──────────────────────────────────────────────────

test('GET /api/recipes → 200 (M3 public route intact)', async () => {
  const res = await app.request('/api/recipes')
  expect(res.status).toBe(200)
  const rows = await res.json()
  expect(Array.isArray(rows)).toBe(true)
})

test('GET /api/me/collections without identity → 401 (M3 identity guard intact)', async () => {
  const res = await app.request('/api/me/collections')
  expect(res.status).toBe(401)
})

test('GET /api/health → 200 (health route intact)', async () => {
  const res = await app.request('/api/health')
  expect(res.status).toBe(200)
  const body: Record<string, unknown> = await res.json()
  expect(body['ok']).toBe(true)
})
