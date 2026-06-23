import { Hono } from 'hono'
import { getDb, listBeans, findBeans, getBean } from '@brewdial/db'

export const beans = new Hono()

// GET /beans[?q=&limit=]
beans.get('/', async (c) => {
  const db = getDb()
  const q = c.req.query('q')
  if (q !== undefined && q !== '') {
    const limitParam = c.req.query('limit')
    const parsed = limitParam ? parseInt(limitParam, 10) : NaN
    // Guard against non-numeric ?limit= (e.g. ?limit=abc) — fall back to default.
    const limit = Number.isFinite(parsed) ? parsed : undefined
    const rows = await findBeans(db, q, limit)
    return c.json(rows)
  }
  const rows = await listBeans(db)
  return c.json(rows)
})

// GET /beans/:id
beans.get('/:id', async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const row = await getBean(db, id)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})
