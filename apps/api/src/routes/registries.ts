import { Hono } from 'hono'
import { getDb, listGrinders, listDrippers } from '@brewdial/db'

export const registries = new Hono()

// GET /grinders
registries.get('/grinders', async (c) => {
  const db = getDb()
  const rows = await listGrinders(db)
  return c.json(rows)
})

// GET /drippers
registries.get('/drippers', async (c) => {
  const db = getDb()
  const rows = await listDrippers(db)
  return c.json(rows)
})
