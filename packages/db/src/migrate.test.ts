import { afterAll, expect, test } from 'vitest'
import { sql } from 'kysely'
import { getDb, closeDb } from './db.js'

afterAll(() => closeDb())

const TABLES = ['recipes','feedback','preferences','beans','app_users','user_identities',
  'grinders','drippers','user_gear','grinder_calibration','saved_recipes','saved_beans']

test('all core tables exist after migration', async () => {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables where table_schema = 'public'`.execute(getDb())
  const names = new Set(rows.map(r => r.table_name))
  for (const t of TABLES) expect(names.has(t), `missing table ${t}`).toBe(true)
})

test('recipe_code_seq and pgcrypto present', async () => {
  const seq = await sql<{ exists: boolean }>`select exists(select 1 from pg_class where relname='recipe_code_seq' and relkind='S') as exists`.execute(getDb())
  expect(seq.rows[0].exists).toBe(true)
  const ext = await sql<{ exists: boolean }>`select exists(select 1 from pg_extension where extname='pgcrypto') as exists`.execute(getDb())
  expect(ext.rows[0].exists).toBe(true)
})
