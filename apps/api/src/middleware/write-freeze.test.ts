import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { closeDb, getDb, resolveAppUser } from '@brewdial/db'
import { app } from '../app.js'

// Always the in-process Hono app: the switch exists only in the Node API, also when
// scripts/contract-test.sh points the rest of this suite at Spring.
const dir = mkdtempSync(join(tmpdir(), 'write-freeze-'))
const flag = join(dir, 'write-freeze')
const seed = randomUUID().replace(/-/g, '')
const knownKey = `freeze-known-${seed}`
const unknownKey = `freeze-unknown-${seed}`
let knownUser: string

beforeAll(async () => {
  knownUser = await resolveAppUser(getDb(), 'toss_anon', knownKey)
  process.env.BREWDIAL_WRITE_FREEZE_FILE = flag
})

afterEach(() => rmSync(flag, { force: true }))

afterAll(async () => {
  delete process.env.BREWDIAL_WRITE_FREEZE_FILE
  rmSync(dir, { recursive: true, force: true })
  await getDb().deleteFrom('app_users').where('id', '=', knownUser).execute()
  await closeDb()
})

const freeze = () => writeFileSync(flag, '')

const identityCount = (key: string) =>
  getDb()
    .selectFrom('user_identities')
    .select('id')
    .where('external_key', '=', key)
    .execute()
    .then((rows) => rows.length)

test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s answers 503 while frozen, on both mounts', async (method) => {
  freeze()
  for (const path of ['/api/agent/recipes', '/agent/recipes', '/me/gear']) {
    const response = await app.request(path, { method })
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('300')
    expect(await response.json()).toEqual({ ok: false, error: 'read-only maintenance' })
  }
})

test('the probe path answers 503 frozen and 404 otherwise, so it can never write', async () => {
  expect((await app.request('/api/write-freeze-probe', { method: 'POST' })).status).toBe(404)
  freeze()
  expect((await app.request('/api/write-freeze-probe', { method: 'POST' })).status).toBe(503)
})

test('reads keep working while frozen', async () => {
  freeze()
  expect((await app.request('/api/beans')).status).toBe(200)
  expect((await app.request('/api/db/health')).status).toBe(200)
})

test('a frozen CORS preflight still passes', async () => {
  freeze()
  const response = await app.request('/api/me/gear', {
    method: 'OPTIONS',
    headers: { Origin: 'https://brewdial.robinco.dev', 'Access-Control-Request-Method': 'PUT' },
  })
  expect(response.status).toBe(204)
})

test('a frozen GET does not create a first-touch user', async () => {
  freeze()
  const response = await app.request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': `toss_anon:${unknownKey}` },
  })
  expect(response.status).toBe(401)
  expect(await identityCount(unknownKey)).toBe(0)
})

test('a frozen GET still recognises an existing user', async () => {
  freeze()
  const response = await app.request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': `toss_anon:${knownKey}` },
  })
  expect(response.status).toBe(200)
})

test('without the file a first touch creates the user as before', async () => {
  const key = `${unknownKey}-open`
  const response = await app.request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': `toss_anon:${key}` },
  })
  expect(response.status).toBe(200)
  expect(await identityCount(key)).toBe(1)
  const row = await getDb().selectFrom('user_identities').select('app_user_id').where('external_key', '=', key).executeTakeFirstOrThrow()
  await getDb().deleteFrom('app_users').where('id', '=', row.app_user_id).execute()
})

test('an unset variable means no freeze', async () => {
  delete process.env.BREWDIAL_WRITE_FREEZE_FILE
  freeze()
  expect((await app.request('/api/write-freeze-probe', { method: 'POST' })).status).toBe(404)
  process.env.BREWDIAL_WRITE_FREEZE_FILE = flag
})
