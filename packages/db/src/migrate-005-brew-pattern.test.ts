// 005 corrects pre-fix brew snapshots: a pour stored as 'ring' before 2026-11-22 came
// from xBloom cloud pattern code 1 and is really 'center'.
//
// `pnpm db:migrate` has already applied and recorded 005 before this suite runs, so the
// test applies the migration's own statements, split and executed on one connection the
// way the runner does, against fixture rows it inserts itself.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createConnection } from 'mysql2/promise'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { sql } from 'kysely'
import { getDb, closeDb } from './db.js'
import { splitMysqlScript } from '../scripts/migrate-mysql.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationPath = path.join(here, '..', 'migrations-mysql', '005_brew_snapshot_pattern_center.sql')
const CUTOFF = '2026-11-22 00:00:00'

const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
const ids = {
  preRing: `t005${suffix}a`,
  preNoRing: `t005${suffix}b`,
  atCutoff: `t005${suffix}c`,
  postRing: `t005${suffix}d`,
}

type Pattern = 'spiral' | 'ring' | 'center'

function pour(pattern: Pattern, index: number) {
  return {
    volumeMl: 40 + index * 10,
    temperatureC: 93,
    flowRate: [3, 3.1, 3.2, 3.3][index],
    pattern,
    pauseSec: 5 + index,
    vibrationBefore: index % 2 === 0,
    vibrationAfter: index % 2 === 1,
  }
}

function snapshot(patterns: Pattern[]) {
  return {
    doseG: 15,
    grinderSize: 58,
    rpm: 110,
    cupType: 1,
    bypassEnabled: false,
    bypassVolumeMl: 0,
    bypassTemperatureC: 0,
    pours: patterns.map((pattern, index) => pour(pattern, index)),
  }
}

function brewRow(id: string, createdAt: string, patterns: Pattern[]) {
  return {
    xbloom_brew_id: id,
    brewed_at: new Date('2026-11-20T22:00:00.000Z'),
    brew_time_sec: 180,
    recipe_name: `005 fixture ${id}`,
    xbloom_recipe_id: null,
    total_water_ml: 250,
    final_cup_g: 240,
    retention_g: 10,
    pour_end_sec: 90,
    cup_at_pour_end_g: 200,
    drawdown_sec: 30,
    early_drawdown_g_per_sec: 3.1,
    recipe_snapshot: snapshot(patterns),
    curve: [[0, 0], [120, 100], [250, 240]],
    created_at: new Date(createdAt),
  }
}

const fixtures = {
  // (a) pre-cutoff, last pour stored as ring by the old mapping
  preRing: brewRow(ids.preRing, '2026-11-20T22:00:00.000Z', ['spiral', 'spiral', 'spiral', 'ring']),
  // (c) pre-cutoff, no ring at all
  preNoRing: brewRow(ids.preNoRing, '2026-11-21T23:59:59.000Z', ['spiral', 'spiral', 'center', 'spiral']),
  // exactly at the cutoff: `created_at < cutoff` must leave it alone
  atCutoff: brewRow(ids.atCutoff, '2026-11-22T00:00:00.000Z', ['spiral', 'ring', 'spiral', 'spiral']),
  // (b) post-cutoff, genuine rings from the fixed mapping
  postRing: brewRow(ids.postRing, '2026-11-22T02:06:00.000Z', ['spiral', 'ring', 'ring', 'spiral']),
}

function expectedRow(fixture: typeof fixtures.preRing) {
  return {
    ...fixture,
    brewed_at: fixture.brewed_at.toISOString(),
    created_at: fixture.created_at.toISOString(),
  }
}

function jsonValue(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

async function readBrew(id: string) {
  const { rows } = await sql<Record<string, unknown>>`
    select * from brews where xbloom_brew_id = ${id}`.execute(getDb())
  expect(rows, `brew ${id} is missing`).toHaveLength(1)
  const row = rows[0] as Record<string, unknown>
  return {
    ...row,
    brewed_at: new Date(row['brewed_at'] as string | Date).toISOString(),
    created_at: new Date(row['created_at'] as string | Date).toISOString(),
    recipe_snapshot: jsonValue(row['recipe_snapshot']),
    curve: jsonValue(row['curve']),
  }
}

async function snapshotText(id: string): Promise<string> {
  const { rows } = await sql<{ text: string }>`
    select cast(recipe_snapshot as char) as text from brews where xbloom_brew_id = ${id}`.execute(getDb())
  return rows[0]!.text
}

async function patternsOf(id: string): Promise<string[]> {
  const row = await readBrew(id)
  return ((row.recipe_snapshot as { pours: Array<{ pattern: string }> }).pours).map((p) => p.pattern)
}

async function preCutoffRingRows(): Promise<number> {
  const { rows } = await sql<{ n: number | string }>`
    select count(*) as n from brews
    where created_at < ${CUTOFF}
      and json_search(recipe_snapshot, 'one', 'ring', null, '$.pours[*].pattern') is not null`.execute(getDb())
  return Number(rows[0]!.n)
}

/** Apply 005 the way the runner does: one connection, statements split client-side. */
async function applyMigration(): Promise<number> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const script = await readFile(migrationPath, 'utf8')
  const connection = await createConnection({ uri: url, timezone: 'Z', multipleStatements: false })
  try {
    await connection.query("set time_zone = '+00:00'")
    let affected = 0
    for (const statement of splitMysqlScript(script)) {
      const result = (await connection.query(statement))[0] as unknown as { affectedRows?: number }
      if (/^update\b/i.test(statement)) affected = Number(result?.affectedRows ?? 0)
    }
    return affected
  } finally {
    await connection.end()
  }
}

beforeAll(async () => {
  const db = getDb()
  const existing = await db
    .selectFrom('brews')
    .select('xbloom_brew_id')
    .where('xbloom_brew_id', 'in', Object.values(ids))
    .execute()
  expect(existing, 'fixture brew id already exists').toEqual([])
  await db.insertInto('brews').values(Object.values(fixtures)).execute()
})

afterAll(async () => {
  await getDb().deleteFrom('brews').where('xbloom_brew_id', 'in', Object.values(ids)).execute()
  await closeDb()
})

test('005 rewrites only pre-cutoff ring pours to center', async () => {
  const before = {
    preNoRing: await snapshotText(ids.preNoRing),
    atCutoff: await snapshotText(ids.atCutoff),
    postRing: await snapshotText(ids.postRing),
  }
  const expectedMatches = await preCutoffRingRows()
  expect(expectedMatches, 'only fixture (a) holds a pre-cutoff ring in this database').toBe(1)

  const affected = await applyMigration()
  expect(affected).toBe(expectedMatches)

  // (a) the last pour becomes center; every other field, pour key and snapshot key is equal
  expect(await patternsOf(ids.preRing)).toEqual(['spiral', 'spiral', 'spiral', 'center'])
  expect(await readBrew(ids.preRing)).toEqual(
    expectedRow({ ...fixtures.preRing, recipe_snapshot: snapshot(['spiral', 'spiral', 'spiral', 'center']) }),
  )

  // (b) post-cutoff genuine rings are untouched, byte for byte
  expect(await snapshotText(ids.postRing)).toBe(before.postRing)
  expect(await readBrew(ids.postRing)).toEqual(expectedRow(fixtures.postRing))

  // (c) a pre-cutoff row without ring is untouched
  expect(await snapshotText(ids.preNoRing)).toBe(before.preNoRing)
  expect(await readBrew(ids.preNoRing)).toEqual(expectedRow(fixtures.preNoRing))

  // a row created exactly at the cutoff is not pre-fix
  expect(await snapshotText(ids.atCutoff)).toBe(before.atCutoff)
  expect(await patternsOf(ids.atCutoff)).toEqual(['spiral', 'ring', 'spiral', 'spiral'])
})

test('a second application changes nothing', async () => {
  await applyMigration()
  const before = {
    preRing: await snapshotText(ids.preRing),
    preNoRing: await snapshotText(ids.preNoRing),
    atCutoff: await snapshotText(ids.atCutoff),
    postRing: await snapshotText(ids.postRing),
  }

  const affected = await applyMigration()
  expect(affected).toBe(0)

  expect({
    preRing: await snapshotText(ids.preRing),
    preNoRing: await snapshotText(ids.preNoRing),
    atCutoff: await snapshotText(ids.atCutoff),
    postRing: await snapshotText(ids.postRing),
  }).toEqual(before)
})
