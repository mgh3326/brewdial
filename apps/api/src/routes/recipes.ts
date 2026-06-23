import { Hono } from 'hono'
import { getDb, listRecentRecipes, getRecipeByCode, listRecipesByBean, insertManualRecipe } from '@brewdial/db'
import { validateCreateRecipeInput } from '@brewdial/shared'

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

// POST /recipes — server always controls owner_id, is_official, created_by
recipes.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  const result = validateCreateRecipeInput(body)
  if (!result.ok) {
    return c.json({ error: 'validation failed', details: result.errors }, 400)
  }
  const input = result.value
  // Strip any owner/official/created_by keys — the server always controls these.
  const row = await insertManualRecipe(getDb(), {
    method: input.method,
    title: input.title,
    beanId: input.beanId,
    beanSnapshot: input.beanSnapshot,
    params: input.params,
    steps: input.steps,
    intent: input.intent,
    notes: input.notes,
    adjustmentFromPrevious: input.adjustmentFromPrevious,
    dripperPortability: input.dripperPortability,
  })
  return c.json(row, 201)
})

// GET /recipes/:code
recipes.get('/:code', async (c) => {
  const db = getDb()
  const code = c.req.param('code')
  const row = await getRecipeByCode(db, code)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})
