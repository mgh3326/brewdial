// Migration 004 seeds the xBloom Studio grinder and two drippers. Runs the real
// `db:migrate` entry point twice against the MySQL in CI, then reads the rows back.
// Skipped unless DATABASE_URL is a mysql:// URL, so the Postgres job does not run it.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { sql } from 'kysely'
import { closeDb, getDb } from '@brewdial/db'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function runMigrations(): string {
  return execFileSync('pnpm', ['db:migrate'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe.skipIf(!process.env.DATABASE_URL?.startsWith('mysql://'))('migration 004 registry rows', () => {
  afterAll(() => closeDb())

  test('running all migrations twice leaves one row per new name with the expected class and geometry', async () => {
    runMigrations()
    const secondRunLog = runMigrations()
    expect(secondRunLog).toContain('nothing to apply')

    const db = getDb()
    for (const name of ['xBloom Studio', 'Omni Dripper 2', 'V60 Neo 01']) {
      const count = await sql<{ n: string | number }>`
        select count(*) as n from grinders where lower(name) = lower(${name})`.execute(db)
      const drippers = await sql<{ n: string | number }>`
        select count(*) as n from drippers where lower(name) = lower(${name})`.execute(db)
      expect(Number(count.rows[0].n) + Number(drippers.rows[0].n), name).toBe(1)
    }

    const grinder = await sql<{ name: string; stepless: boolean }>`
      select name, stepless from grinders where name = 'xBloom Studio'`.execute(db)
    expect(grinder.rows).toEqual([{ name: 'xBloom Studio', stepless: false }])

    const dripperRows = await sql<{ name: string; class: string; geometry: string | null }>`
      select name, class, geometry from drippers
      where name in ('Omni Dripper 2', 'V60 Neo 01') order by name`.execute(db)
    expect(dripperRows.rows).toEqual([
      { name: 'Omni Dripper 2', class: 'bed_restricted', geometry: null },
      { name: 'V60 Neo 01', class: 'bed_restricted', geometry: null },
    ])
  }, 120_000)
})
