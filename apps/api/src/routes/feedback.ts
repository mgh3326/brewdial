import { Hono } from 'hono'
import { getDb, listFeedbackByRecipe, getRecipeByCode } from '@brewdial/db'

export const feedback = new Hono()

// GET /recipes/:code/feedback
feedback.get('/:code/feedback', async (c) => {
  const db = getDb()
  const code = c.req.param('code')
  const appUserId = c.get('appUserId') as string | undefined
  // Visibility gate (ROB-642 C2): private recipes only resolve for their owner.
  const recipe = await getRecipeByCode(db, code, appUserId)
  if (!recipe) return c.json({ error: 'recipe not found' }, 404)
  const rows = await listFeedbackByRecipe(db, code, appUserId)
  return c.json(rows)
})
