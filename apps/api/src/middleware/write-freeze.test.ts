import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { sql } from 'kysely'
import { closeDb, getDb, resolveAppUser } from '@brewdial/db'
import { app } from '../app.js'
import { trackWrite } from './write-freeze.js'

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

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve: () => resolve() }
}

const lockWaiters = async () => {
  const result = await sql<{ waiting: number }>`
    select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock'
  `.execute(getDb())
  return result.rows[0].waiting
}

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

test('a real mutating route reached through the app is refused and writes nothing', async () => {
  const label = `frozen-${seed}`
  freeze()

  const response = await app.request('/api/me/gear', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'X-BrewDial-Identity': `toss_anon:${knownKey}` },
    body: JSON.stringify({ kind: 'grinder', label }),
  })

  expect(response.status).toBe(503)
  const rows = await getDb().selectFrom('user_gear').select('id').where('label', '=', label).execute()
  expect(rows).toHaveLength(0)
})

test('the probe path answers 503 frozen and 404 otherwise, so it can never write', async () => {
  expect((await app.request('/api/write-freeze-probe', { method: 'POST' })).status).toBe(404)
  freeze()
  expect((await app.request('/api/write-freeze-probe', { method: 'POST' })).status).toBe(503)
})

const writesInFlight = async () => {
  const response = await app.request('/api/write-freeze-probe', { method: 'POST' })
  expect(response.status).toBe(503)
  return response.headers.get('x-writes-in-flight')
}

// Holds a table, so that an admitted write blocks in the database like a slow one.
async function holdTable(table: 'user_gear' | 'app_users') {
  const release = deferred()
  const locked = deferred()
  const lock = getDb()
    .transaction()
    .execute(async (trx) => {
      await sql`lock table ${sql.table(table)} in access exclusive mode`.execute(trx)
      locked.resolve()
      await release.promise
    })
  await locked.promise
  return async () => {
    release.resolve()
    await lock
  }
}

test('a write admitted before the freeze counts until it commits', async () => {
  const label = `admitted-${seed}`
  const release = await holdTable('user_gear')

  const write = app.request('/api/me/gear', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'X-BrewDial-Identity': `toss_anon:${knownKey}` },
    body: JSON.stringify({ kind: 'grinder', label }),
  })
  await expect.poll(lockWaiters).toBeGreaterThan(0)

  freeze()
  expect(await writesInFlight()).toBe('1')

  await release()
  expect((await write).status).toBe(200)
  expect(await writesInFlight()).toBe('0')
  const rows = await getDb().selectFrom('user_gear').select('id').where('label', '=', label).execute()
  expect(rows).toHaveLength(1)
})

test('a first-touch GET admitted before the freeze counts until it finishes', async () => {
  const key = `${unknownKey}-admitted`
  const release = await holdTable('app_users')

  const read = app.request('/api/me/collections', {
    headers: { 'X-BrewDial-Identity': `toss_anon:${key}` },
  })
  await expect.poll(lockWaiters).toBeGreaterThan(0)

  freeze()
  expect(await writesInFlight()).toBe('1')

  await release()
  expect((await read).status).toBe(200)
  expect(await writesInFlight()).toBe('0')
  const row = await getDb().selectFrom('user_identities').select('app_user_id').where('external_key', '=', key).executeTakeFirstOrThrow()
  await getDb().deleteFrom('app_users').where('id', '=', row.app_user_id).execute()
})

test('a failed write stops counting', async () => {
  await expect(trackWrite(() => Promise.reject(new Error('failed')))).rejects.toThrow('failed')
  freeze()
  expect(await writesInFlight()).toBe('0')
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
