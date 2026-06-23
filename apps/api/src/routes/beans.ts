import { Hono } from 'hono'
import { getDb, listBeans, getBean } from '@brewdial/db'

export const beans = new Hono()

// GET /beans
beans.get('/', async (c) => {
  const db = getDb()
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
