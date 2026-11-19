import { afterAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { getDb, closeDb } from './db.js'
import { resolveAppUser } from './repositories/identity.js'

afterAll(() => closeDb())
const db = getDb()

test('concurrent first-touch of same identity yields one app_user and zero orphans', async () => {
  const key = 'concurrencytestkey_' + randomUUID().replace(/-/g, '') // >=16 chars, fresh each run
  const ids = new Set(
    await Promise.all(Array.from({ length: 20 }, () => resolveAppUser(db, 'toss_anon', key))),
  )
  expect(ids.size).toBe(1)

  // zero orphan app_users (rows with no user_identities) — scoped to the UUID
  // returned by the concurrent calls so parallel test files don't interfere.
  const resolvedId = [...ids][0]
  const orphans = await sql<{ n: number | string }>`
    select count(*) as n from app_users a
    where a.id = ${resolvedId}
      and not exists (select 1 from user_identities ui where ui.app_user_id = a.id)`.execute(db)
  expect(Number(orphans.rows[0].n)).toBe(0)

  // Also verify exactly one user_identities row exists for this (provider, key): the unique
  // key on user_identities makes the losing concurrent inserts fail and adopt the winner.
  const userCount = await sql<{ n: number | string }>`
    select count(*) as n from user_identities
    where provider = 'toss_anon' and external_key = ${key}`.execute(db)
  expect(Number(userCount.rows[0].n)).toBe(1)
})
