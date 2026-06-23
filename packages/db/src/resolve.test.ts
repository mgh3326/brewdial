import { afterAll, expect, test } from 'vitest'
import { sql } from 'kysely'
import { getDb, closeDb } from './db.js'

afterAll(() => closeDb())
const db = getDb()

test('concurrent first-touch of same identity yields one app_user and zero orphans', async () => {
  const key = 'concurrencytestkey_' + '0'.repeat(20) // >=16 chars
  const calls = Array.from({ length: 20 }, () =>
    sql<{ resolve_app_user: string }>`select resolve_app_user('toss_anon', ${key}) as resolve_app_user`.execute(db))
  const results = await Promise.all(calls)
  const ids = new Set(results.map(r => r.rows[0].resolve_app_user))
  expect(ids.size).toBe(1)

  // zero orphan app_users (rows with no user_identities) — scoped to the UUID
  // returned by the concurrent calls so parallel test files don't interfere.
  const resolvedId = [...ids][0]
  const orphans = await sql<{ n: number }>`
    select count(*)::int as n from app_users a
    where a.id = ${resolvedId}::uuid
      and not exists (select 1 from user_identities ui where ui.app_user_id = a.id)`.execute(db)
  expect(orphans.rows[0].n).toBe(0)

  // Also verify exactly one app_user maps to this (provider, key) — the advisory lock
  // prevents multiple app_users being created for the same identity key.
  const userCount = await sql<{ n: number }>`
    select count(*)::int as n from user_identities
    where provider = 'toss_anon' and external_key = ${key}`.execute(db)
  expect(userCount.rows[0].n).toBe(1)
})
