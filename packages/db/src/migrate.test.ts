import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, test } from 'vitest'
import { sql } from 'kysely'
import { getDb, closeDb } from './db.js'
import { listMysqlMigrations, MYSQL_MIGRATION_TABLE } from '../scripts/migrate-mysql.js'

afterAll(() => closeDb())

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations-mysql')

const TABLES = ['recipes','feedback','preferences','beans','app_users','user_identities',
  'grinders','drippers','user_gear','grinder_calibration','saved_recipes','saved_beans']

test('all core tables exist after migration', async () => {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables where table_schema = database()`.execute(getDb())
  const names = new Set(rows.map(r => r.table_name))
  for (const t of TABLES) expect(names.has(t), `missing table ${t}`).toBe(true)
})

test('every migrations-mysql file is recorded in schema_migrations and recipe_code_seq is seeded', async () => {
  const expected = (await listMysqlMigrations(migrationsDir)).map((f) => f.replace(/\.sql$/, ''))
  const { rows } = await sql<{ version: string }>`
    select version from ${sql.table(MYSQL_MIGRATION_TABLE)} order by version`.execute(getDb())
  expect(rows.map((r) => r.version)).toEqual(expected)

  const seq = await sql<{ value: number | string }>`select value from recipe_code_seq where id = 1`.execute(getDb())
  expect(seq.rows).toHaveLength(1)
})
