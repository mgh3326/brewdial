import { afterAll, expect, test } from 'vitest'
import { sql } from 'kysely'
import { getDb, closeDb } from './db.js'

afterAll(() => closeDb())

test('connects to postgres and runs select 1', async () => {
  const { rows } = await sql<{ one: number }>`select 1 as one`.execute(getDb())
  expect(rows[0].one).toBe(1)
})
