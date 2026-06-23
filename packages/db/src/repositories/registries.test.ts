import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '../db.js'
import { listGrinders } from './registries.js'

afterAll(() => closeDb())

const idZZ = randomUUID()
const idAA = randomUUID()

beforeAll(async () => {
  const db = getDb()
  // Clean up any leftover rows from a previous partial run (safety net)
  await db.deleteFrom('grinders').where('id', 'in', [idZZ, idAA]).execute()
})

afterAll(async () => {
  const db = getDb()
  await db.deleteFrom('grinders').where('id', 'in', [idZZ, idAA]).execute()
})

test('listGrinders returns rows ordered by name (typed)', async () => {
  const db = getDb()
  // Seed two grinders with unique UUIDs so re-runs don't hit duplicate-PK errors.
  // grinders only requires `name`; all other columns have defaults or are nullable.
  await db.insertInto('grinders').values([
    { id: idZZ, name: 'ZZ Grinder' },
    { id: idAA, name: 'AA Grinder' },
  ]).execute()

  const rows = await listGrinders(db)
  const names = rows.map(r => r.name)
  // Verify ordering: AA should appear before ZZ
  expect(names.indexOf('AA Grinder')).toBeGreaterThanOrEqual(0)
  expect(names.indexOf('ZZ Grinder')).toBeGreaterThanOrEqual(0)
  expect(names.indexOf('AA Grinder')).toBeLessThan(names.indexOf('ZZ Grinder'))
})
