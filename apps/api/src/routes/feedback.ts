import { Hono } from 'hono'
import { getDb, listFeedbackByRecipe } from '@brewdial/db'

export const feedback = new Hono()

// GET /recipes/:code/feedback
feedback.get('/:code/feedback', async (c) => {
  const db = getDb()
  const code = c.req.param('code')
  const rows = await listFeedbackByRecipe(db, code)
  return c.json(rows)
})
