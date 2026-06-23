import { afterAll, expect, test } from 'vitest'
import { sql } from 'kysely'
import { getDb, closeDb } from './db.js'

afterAll(() => closeDb())
const db = getDb()

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
