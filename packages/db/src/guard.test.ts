import { afterAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { withOwnerWrites } from './owner-writes.js'
import { getDb, closeDb } from './db.js'

const db = getDb()

const SEED = randomUUID().replace(/-/g, '').slice(0, 8)
const createdBeanIds: string[] = []
const createdRecipeCodes: string[] = []

// MySQL has no RETURNING and no DEFAULT VALUES id: ids and recipe codes are chosen here,
// then read back by value.
const newUserId = async (): Promise<string> => {
  const id = randomUUID()
  await sql`insert into app_users (id) values (${id})`.execute(db)
  return id
}
const recipeCode = (tag: string): string => {
  const code = `T-GUARD-${SEED}-${tag}`
  createdRecipeCodes.push(code)
  return code
}

afterAll(async () => {
  if (createdRecipeCodes.length > 0) {
    await sql`delete from recipes where code in (${sql.join(createdRecipeCodes)})`.execute(db)
  }
  if (createdBeanIds.length > 0) {
    await sql`delete from beans where id in (${sql.join(createdBeanIds)})`.execute(db)
  }
  await closeDb()
})

test('non-owner insert forces owner_id NULL / is_official false / created_by manual', async () => {
  const code = recipeCode('probe')
  await sql`
    insert into recipes (code, method, title, owner_id, is_official, created_by)
    values (${code}, 'v60', 'guard probe', ${randomUUID()}, true, 'agent')`.execute(db)
  const row = await sql<{ owner_id: string | null; is_official: boolean; created_by: string }>`
    select owner_id, is_official, created_by from recipes where code = ${code}`.execute(db)
  expect(row.rows[0].owner_id).toBeNull()
  expect(row.rows[0].is_official).toBe(false)
  expect(row.rows[0].created_by).toBe('manual')
})

test('bean auto-links on insert when bean_snapshot present and bean_id null', async () => {
  const code = recipeCode('bean-link')
  await sql`
    insert into recipes (code, method, title, bean_snapshot)
    values (${code}, 'v60', 'bean link probe', json_object('name', 'Probe Bean', 'roaster', 'ProbeRoaster'))`.execute(db)
  const r = await sql<{ bean_id: string | null }>`select bean_id from recipes where code = ${code}`.execute(db)
  expect(r.rows[0].bean_id).not.toBeNull()
})

test('owner write flag permits owner_id, then guard immutability raises on update', async () => {
  const uid = await newUserId()
  const code = recipeCode('owned')
  await withOwnerWrites(db, async (trx) => {
    await sql`insert into recipes (code, method, title, owner_id) values (${code}, 'v60', 'owned', ${uid})`.execute(trx)
  })
  await expect(
    sql`update recipes set is_official = true where code = ${code}`.execute(db)
  ).rejects.toThrow()
})

// ─── ROB-642 C4 / C5 ──────────────────────────────────────────────────────────

test('C4: bean_summaries recipe_count excludes owner-scoped recipes', async () => {
  const beanId = `c4bean_${SEED}`
  createdBeanIds.push(beanId)
  await sql`insert into beans (id, name) values (${beanId}, ${`C4 Bean ${SEED}`})`.execute(db)

  // Public recipe (no owner_write_ok → guard forces owner_id null).
  await sql`
    insert into recipes (code, method, title, bean_id, created_by)
    values (${recipeCode('c4-pub')}, 'v60', ${`C4 Pub ${SEED}`}, ${beanId}, 'manual')`.execute(db)

  // Private recipe (owner_write_ok → owner_id set).
  const uid = await newUserId()
  await withOwnerWrites(db, async (trx) => {
    await sql`
      insert into recipes (code, method, title, bean_id, owner_id, created_by)
      values (${recipeCode('c4-priv')}, 'v60', ${`C4 Priv ${SEED}`}, ${beanId}, ${uid}, 'manual')`.execute(trx)
  })

  const r = await sql<{ recipe_count: string | number }>`
    select recipe_count from bean_summaries where id = ${beanId}`.execute(db)
  expect(Number(r.rows[0].recipe_count)).toBe(1)
})

test('C5: owned insert with new snapshot does not create a global bean', async () => {
  const newName = `C5 NoMatch ${SEED}`
  const newRoaster = `C5RM ${SEED}`
  const uid = await newUserId()
  const code = recipeCode('c5-nomatch')

  await withOwnerWrites(db, async (trx) => {
    await sql`
      insert into recipes (code, method, title, bean_id, owner_id, bean_snapshot, created_by)
      values (${code}, 'v60', ${`C5 NoMatch ${SEED}`}, null, ${uid},
              json_object('name', ${newName}, 'roaster', ${newRoaster}, 'notes', 'should-not-create'),
              'manual')`.execute(trx)
  })

  const beanRow = await sql<{ id: string }>`
    select id from beans where name = ${newName} and roaster = ${newRoaster}`.execute(db)
  expect(beanRow.rows.length).toBe(0)
  const link = await sql<{ bean_id: string | null }>`select bean_id from recipes where code = ${code}`.execute(db)
  expect(link.rows[0].bean_id).toBeNull()
})

test('C5: owned insert with matching snapshot links without overwriting', async () => {
  const name = `C5 Match ${SEED}`
  const roaster = `C5RM ${SEED}`
  const beanId = `c5match_${SEED}`
  createdBeanIds.push(beanId)
  await sql`insert into beans (id, name, roaster, origin, notes)
    values (${beanId}, ${name}, ${roaster}, 'ORIGINAL ORIGIN', 'ORIGINAL NOTES')`.execute(db)

  const uid = await newUserId()
  const code = recipeCode('c5-match')
  await withOwnerWrites(db, async (trx) => {
    await sql`
      insert into recipes (code, method, title, bean_id, owner_id, bean_snapshot, created_by)
      values (${code}, 'v60', ${`C5 Match Recipe ${SEED}`}, null, ${uid},
              json_object('name', ${name}, 'roaster', ${roaster},
                          'notes', 'INTRUDER NOTES', 'origin', 'INTRUDER ORIGIN'),
              'manual')`.execute(trx)
  })

  const linked = await sql<{ bean_id: string | null }>`select bean_id from recipes where code = ${code}`.execute(db)
  expect(linked.rows[0].bean_id).toBe(beanId)

  const beanRow = await sql<{ origin: string; notes: string }>`
    select origin, notes from beans where id = ${beanId}`.execute(db)
  expect(beanRow.rows[0].origin).toBe('ORIGINAL ORIGIN')
  expect(beanRow.rows[0].notes).toBe('ORIGINAL NOTES')
})
