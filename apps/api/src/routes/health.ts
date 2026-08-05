import { Hono } from 'hono'
import { sql } from 'kysely'
import { getDb } from '@brewdial/db'

export const health = new Hono()

health.get('/health', (c) => c.json({ ok: true, service: 'brewdial-api', ts: new Date().toISOString() }))

health.get('/db/health', async (c) => {
  try {
    await sql`select 1`.execute(getDb())
    return c.json({ ok: true, db: 'up' })
  } catch {
    return c.json({ ok: false, db: 'down' }, 503)
  }
})
