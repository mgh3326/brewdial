import { Hono } from 'hono'
import { getDb, listRecentRecipes, getRecipeByCode, listRecipesByBean } from '@brewdial/db'

export const recipes = new Hono()

// GET /recipes?limit=&beanId=
recipes.get('/', async (c) => {
  const db = getDb()
  const appUserId = c.get('appUserId') as string | undefined
  const beanId = c.req.query('beanId')
  if (beanId) {
    const rows = await listRecipesByBean(db, beanId, appUserId)
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
  const appUserId = c.get('appUserId') as string | undefined
  const code = c.req.param('code')
  const row = await getRecipeByCode(db, code, appUserId)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})
