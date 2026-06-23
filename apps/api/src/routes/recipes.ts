import { Hono } from 'hono'
import { getDb, listRecentRecipes, getRecipeByCode, listRecipesByBean } from '@brewdial/db'

export const recipes = new Hono()

// GET /recipes?limit=&beanId=
recipes.get('/', async (c) => {
  const db = getDb()
  const beanId = c.req.query('beanId')
  if (beanId) {
    const rows = await listRecipesByBean(db, beanId)
    return c.json(rows)
  }
  const limitParam = c.req.query('limit')
  const limit = limitParam ? parseInt(limitParam, 10) : 20
  const rows = await listRecentRecipes(db, isNaN(limit) ? 20 : limit)
  return c.json(rows)
})

// GET /recipes/:code
recipes.get('/:code', async (c) => {
  const db = getDb()
  const code = c.req.param('code')
  const row = await getRecipeByCode(db, code)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})
