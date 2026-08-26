import { request } from '../test/request.js'
/**
 * agent.beans.resync.test.ts — POST /api/agent/beans/:id/resync
 *                              POST /api/agent/beans/:id/purchase-links
 *                              GET  /api/beans/:id/purchase-links
 *
 * find_or_create_bean() only fires on the recipes BEFORE INSERT trigger, so
 * correcting an existing recipe's bean_snapshot left the shared beans row stale
 * (BeanCard/BeanDetail render beans.origin, not the snapshot). Resync closes that
 * gap. Confirms:
 *   - resync copies non-key identity fields from the newest public snapshot
 *   - name/roaster are never rewritten (they are the unique key)
 *   - blank/absent snapshot fields never blank out a stored value (coalesce)
 *   - PRIVATE recipe snapshots are not a resync source (owner privacy, ROB-642)
 *   - purchase links round-trip, and the public GET returns active links only
 */
import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { getDb, closeDb } from '@brewdial/db'


const SEED = randomUUID().replace(/-/g, '').slice(0, 8)
let beanId: string
let ownerId: string
const codes: string[] = []

async function insertRecipe(opts: {
  code: string
  snapshot: Record<string, unknown> | null
  ownerId?: string | null
}) {
  const db = getDb()
  // Direct insert: bean_id is set explicitly so recipes_link_bean is a no-op and
  // the beans row keeps whatever the test seeded it with.
  //
  // owner_id is write-guarded — bd_guard_recipe_owner_immutable forces it to NULL
  // on INSERT unless the txn sets bd.owner_write_ok='on' (002_functions_triggers),
  // so a private fixture has to be written inside such a transaction.
  const values = {
    code: opts.code,
    method: 'v60',
    title: `Resync fixture ${opts.code}`,
    bean_id: beanId,
    bean_snapshot: opts.snapshot === null ? null : JSON.stringify(opts.snapshot),
    owner_id: opts.ownerId ?? null,
  }
  await db.transaction().execute(async (trx) => {
    if (opts.ownerId) {
      await sql`select set_config('bd.owner_write_ok', 'on', true)`.execute(trx)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await trx.insertInto('recipes').values(values as any).execute()
  })
  codes.push(opts.code)
}

beforeAll(async () => {
  process.env.AGENT_TOKEN = 'test-token'
  const db = getDb()
  const bean = await db
    .insertInto('beans')
    .values({
      name: `Resync Bean ${SEED}`,
      roaster: `Roaster ${SEED}`,
      origin: 'STALE ORIGIN',
      process: 'STALE PROCESS',
      roast_level: 'STALE ROAST',
      notes: 'STALE NOTES',
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  beanId = bean.id

  const user = await db
    .insertInto('app_users')
    .values({ display_name: `Resync Owner ${SEED}` })
    .returning('id')
    .executeTakeFirstOrThrow()
  ownerId = user.id
})

afterAll(async () => {
  const db = getDb()
  if (codes.length > 0) {
    await db.deleteFrom('recipes').where('code', 'in', codes).execute()
  }
  await db.deleteFrom('bean_purchase_links').where('bean_id', '=', beanId).execute()
  await db.deleteFrom('beans').where('id', '=', beanId).execute()
  await db.deleteFrom('app_users').where('id', '=', ownerId).execute()
  await closeDb()
})

function agentReq(path: string, options?: RequestInit): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer test-token',
      ...((options?.headers as Record<string, string>) ?? {}),
    },
    ...options,
  })
}

// ── resync ───────────────────────────────────────────────────────────────────

test('resync with no recipes → 200, no source, nothing changed', async () => {
  const res = await request(agentReq(`/api/agent/beans/${beanId}/resync`, { method: 'POST' }))
  expect(res.status).toBe(200)
  const body: Record<string, unknown> = await res.json()
  expect(body['sourceRecipeCode']).toBeNull()
  expect(body['changed']).toEqual([])
  expect((body['bean'] as Record<string, unknown>)['origin']).toBe('STALE ORIGIN')
})

test('resync copies non-key identity fields from the public snapshot', async () => {
  await insertRecipe({
    code: `COF-RSY1-${SEED}`,
    snapshot: {
      name: 'RENAMED — must be ignored',
      roaster: 'REROASTED — must be ignored',
      origin: 'Kurly x Intelligentsia blend',
      process: 'Washed',
      roastLevel: '약배전',
      notes: 'Milk Chocolate, Honey, Cola',
    },
  })

  const res = await request(agentReq(`/api/agent/beans/${beanId}/resync`, { method: 'POST' }))
  expect(res.status).toBe(200)
  const body: Record<string, unknown> = await res.json()
  expect(body['sourceRecipeCode']).toBe(`COF-RSY1-${SEED}`)
  expect(body['changed']).toEqual(['origin', 'process', 'roast_level', 'notes'])

  const bean = body['bean'] as Record<string, unknown>
  expect(bean['origin']).toBe('Kurly x Intelligentsia blend')
  expect(bean['process']).toBe('Washed')
  expect(bean['roast_level']).toBe('약배전')
  expect(bean['notes']).toBe('Milk Chocolate, Honey, Cola')
  // Unique-key fields are never rewritten — a rename is a merge, not a resync.
  expect(bean['name']).toBe(`Resync Bean ${SEED}`)
  expect(bean['roaster']).toBe(`Roaster ${SEED}`)
})

test('resync is idempotent — a second call changes nothing', async () => {
  const res = await request(agentReq(`/api/agent/beans/${beanId}/resync`, { method: 'POST' }))
  expect(res.status).toBe(200)
  const body: Record<string, unknown> = await res.json()
  expect(body['changed']).toEqual([])
})

test('blank / absent snapshot fields do not blank out stored values (coalesce)', async () => {
  await insertRecipe({
    code: `COF-RSY2-${SEED}`,
    // Newer than RSY1. origin is blank and process/notes are absent — all must be
    // skipped rather than wiping the values RSY1 established.
    snapshot: { name: 'x', origin: '   ', roastLevel: '중배전' },
  })

  const res = await request(agentReq(`/api/agent/beans/${beanId}/resync`, { method: 'POST' }))
  expect(res.status).toBe(200)
  const body: Record<string, unknown> = await res.json()
  expect(body['changed']).toEqual(['roast_level'])

  const bean = body['bean'] as Record<string, unknown>
  expect(bean['roast_level']).toBe('중배전')
  expect(bean['origin']).toBe('Kurly x Intelligentsia blend')
  expect(bean['process']).toBe('Washed')
  expect(bean['notes']).toBe('Milk Chocolate, Honey, Cola')
})

test('a PRIVATE recipe snapshot is never a resync source', async () => {
  await insertRecipe({
    code: `COF-RSY3-${SEED}`,
    snapshot: { name: 'x', origin: 'LEAKED PRIVATE ORIGIN' },
    ownerId,
  })

  const res = await request(agentReq(`/api/agent/beans/${beanId}/resync`, { method: 'POST' }))
  expect(res.status).toBe(200)
  const body: Record<string, unknown> = await res.json()
  // Newest PUBLIC snapshot is still RSY2, so nothing changes and the private text
  // never reaches the shared bean card.
  expect(body['sourceRecipeCode']).toBe(`COF-RSY2-${SEED}`)
  expect((body['bean'] as Record<string, unknown>)['origin']).toBe('Kurly x Intelligentsia blend')
})

test('resync unknown bean → 404', async () => {
  const res = await request(
    agentReq(`/api/agent/beans/does-not-exist-${SEED}/resync`, { method: 'POST' })
  )
  expect(res.status).toBe(404)
})

test('resync without the agent token → 401', async () => {
  const res = await request(
    new Request(`http://localhost/api/agent/beans/${beanId}/resync`, { method: 'POST' })
  )
  expect(res.status).toBe(401)
})

// ── purchase links ───────────────────────────────────────────────────────────

test('POST purchase-links → 201, then public GET returns it', async () => {
  const res = await request(
    agentReq(`/api/agent/beans/${beanId}/purchase-links`, {
      method: 'POST',
      body: JSON.stringify({
        vendor: 'Kurly',
        url: 'https://www.kurlyglobal.com/products/m00000176042',
        linkCategory: 'product',
        priceKrw: 31000,
      }),
    })
  )
  expect(res.status).toBe(201)
  const row: Record<string, unknown> = await res.json()
  expect(row['vendor']).toBe('Kurly')
  expect(row['link_category']).toBe('product')
  expect(row['price_krw']).toBe(31000)
  expect(row['active']).toBe(true)

  const list = await request(new Request(`http://localhost/api/beans/${beanId}/purchase-links`))
  expect(list.status).toBe(200)
  const rows: Array<Record<string, unknown>> = await list.json()
  expect(rows).toHaveLength(1)
  expect(rows[0]['url']).toBe('https://www.kurlyglobal.com/products/m00000176042')
})

test('GET purchase-links omits inactive rows', async () => {
  const db = getDb()
  await db
    .updateTable('bean_purchase_links')
    .set({ active: false })
    .where('bean_id', '=', beanId)
    .execute()

  const list = await request(new Request(`http://localhost/api/beans/${beanId}/purchase-links`))
  expect(list.status).toBe(200)
  expect(await list.json()).toEqual([])

  await db
    .updateTable('bean_purchase_links')
    .set({ active: true })
    .where('bean_id', '=', beanId)
    .execute()
})

test('POST purchase-links with a non-https url → 400', async () => {
  const res = await request(
    agentReq(`/api/agent/beans/${beanId}/purchase-links`, {
      method: 'POST',
      body: JSON.stringify({ vendor: 'Kurly', url: 'http://example.com/x' }),
    })
  )
  expect(res.status).toBe(400)
})

test('POST purchase-links for an unknown bean → 404 (not a raw FK 500)', async () => {
  const res = await request(
    agentReq(`/api/agent/beans/does-not-exist-${SEED}/purchase-links`, {
      method: 'POST',
      body: JSON.stringify({ vendor: 'Kurly', url: 'https://example.com/x' }),
    })
  )
  expect(res.status).toBe(404)
})

test('GET purchase-links for an unknown bean → 200 with an empty list', async () => {
  const res = await request(
    new Request(`http://localhost/api/beans/does-not-exist-${SEED}/purchase-links`)
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([])
})
