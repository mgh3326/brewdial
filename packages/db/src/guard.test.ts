import { afterAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { getDb, closeDb } from './db.js'

const db = getDb()

const SEED = randomUUID().replace(/-/g, '').slice(0, 8)
const createdBeanIds: string[] = []
const createdRecipeCodes: string[] = []

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
  const row = await sql<{ owner_id: string | null; is_official: boolean; created_by: string }>`
    insert into recipes (method, title, owner_id, is_official, created_by)
    values ('v60', 'guard probe', gen_random_uuid(), true, 'agent')
    returning owner_id, is_official, created_by`.execute(db)
  expect(row.rows[0].owner_id).toBeNull()
  expect(row.rows[0].is_official).toBe(false)
  expect(row.rows[0].created_by).toBe('manual')
})

test('bean auto-links on insert when bean_snapshot present and bean_id null', async () => {
  const r = await sql<{ bean_id: string | null }>`
    insert into recipes (method, title, bean_snapshot)
    values ('v60','bean link probe', jsonb_build_object('name','Probe Bean','roaster','ProbeRoaster'))
    returning bean_id`.execute(db)
  expect(r.rows[0].bean_id).not.toBeNull()
})

test('owner write flag permits owner_id, then guard immutability raises on update', async () => {
  const uid = (await sql<{ id: string }>`insert into app_users default values returning id`.execute(db)).rows[0].id
  const code = await db.transaction().execute(async (trx) => {
    await sql`select set_config('bd.owner_write_ok','on',true)`.execute(trx)
    const res = await sql<{ code: string }>`
      insert into recipes (method, title, owner_id) values ('v60','owned', ${uid}::uuid) returning code`.execute(trx)
    return res.rows[0].code
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
  const publicCode = await db.transaction().execute(async (trx) => {
    const r = await sql<{ code: string }>`
      insert into recipes (method, title, bean_id, created_by)
      values ('v60', ${`C4 Pub ${SEED}`}, ${beanId}, 'manual')
      returning code`.execute(trx)
    return r.rows[0].code
  })
  createdRecipeCodes.push(publicCode)

  // Private recipe (owner_write_ok → owner_id set).
  const uid = (await sql<{ id: string }>`insert into app_users default values returning id`.execute(db)).rows[0].id
  const privateCode = await db.transaction().execute(async (trx) => {
    await sql`select set_config('bd.owner_write_ok','on',true)`.execute(trx)
    const r = await sql<{ code: string }>`
      insert into recipes (method, title, bean_id, owner_id, created_by)
      values ('v60', ${`C4 Priv ${SEED}`}, ${beanId}, ${uid}::uuid, 'manual')
      returning code`.execute(trx)
    return r.rows[0].code
  })
  createdRecipeCodes.push(privateCode)

  const r = await sql<{ recipe_count: string }>`
    select recipe_count from bean_summaries where id = ${beanId}`.execute(db)
  expect(Number(r.rows[0].recipe_count)).toBe(1)
})

test('C5: owned insert with new snapshot does not create a global bean', async () => {
  const newName = `C5 NoMatch ${SEED}`
  const newRoaster = `C5RM ${SEED}`
  const uid = (await sql<{ id: string }>`insert into app_users default values returning id`.execute(db)).rows[0].id

  const result = await db.transaction().execute(async (trx) => {
    await sql`select set_config('bd.owner_write_ok','on',true)`.execute(trx)
    const r = await sql<{ code: string; bean_id: string | null }>`
      insert into recipes (method, title, bean_id, owner_id, bean_snapshot, created_by)
      values ('v60', ${`C5 NoMatch ${SEED}`}, null, ${uid}::uuid,
              jsonb_build_object('name', ${newName}::text, 'roaster', ${newRoaster}::text,
                                 'notes', 'should-not-create'),
              'manual')
      returning code, bean_id`.execute(trx)
    return r.rows[0]
  })
  createdRecipeCodes.push(result.code)

  const beanRow = await sql<{ id: string }>`
    select id from beans where name = ${newName} and roaster = ${newRoaster}`.execute(db)
  expect(beanRow.rows.length).toBe(0)
  expect(result.bean_id).toBeNull()
})

test('C5: owned insert with matching snapshot links without overwriting', async () => {
  const name = `C5 Match ${SEED}`
  const roaster = `C5RM ${SEED}`
  const beanId = `c5match_${SEED}`
  createdBeanIds.push(beanId)
  await sql`insert into beans (id, name, roaster, origin, notes)
    values (${beanId}, ${name}, ${roaster}, 'ORIGINAL ORIGIN', 'ORIGINAL NOTES')`.execute(db)

  const uid = (await sql<{ id: string }>`insert into app_users default values returning id`.execute(db)).rows[0].id

  const result = await db.transaction().execute(async (trx) => {
    await sql`select set_config('bd.owner_write_ok','on',true)`.execute(trx)
    const r = await sql<{ code: string; bean_id: string | null }>`
      insert into recipes (method, title, bean_id, owner_id, bean_snapshot, created_by)
      values ('v60', ${`C5 Match Recipe ${SEED}`}, null, ${uid}::uuid,
              jsonb_build_object('name', ${name}::text, 'roaster', ${roaster}::text,
                                 'notes', 'INTRUDER NOTES', 'origin', 'INTRUDER ORIGIN'),
              'manual')
      returning code, bean_id`.execute(trx)
    return r.rows[0]
  })
  createdRecipeCodes.push(result.code)

  expect(result.bean_id).toBe(beanId)

  const beanRow = await sql<{ origin: string; notes: string }>`
    select origin, notes from beans where id = ${beanId}`.execute(db)
  expect(beanRow.rows[0].origin).toBe('ORIGINAL ORIGIN')
  expect(beanRow.rows[0].notes).toBe('ORIGINAL NOTES')
})
