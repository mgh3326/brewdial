import { Hono } from 'hono'
import { getDb, listFeedbackByRecipe, insertFeedback } from '@brewdial/db'
import { validateCreateFeedbackInput } from '@brewdial/shared'

export const feedback = new Hono()

// GET /recipes/:code/feedback
feedback.get('/:code/feedback', async (c) => {
  const db = getDb()
  const code = c.req.param('code')
  const rows = await listFeedbackByRecipe(db, code)
  return c.json(rows)
})

// POST /recipes/:code/feedback
feedback.post('/:code/feedback', async (c) => {
  const code = c.req.param('code')
  const body = await c.req.json().catch(() => null)
  // Use a synthetic COF-0000 recipeCode placeholder so the shared validator can
  // check all content fields; the actual recipe_code written to the DB always
  // comes from the path param, never from the body.
  const probeInput = {
    ...(body && typeof body === 'object' ? body : {}),
    recipeCode: 'COF-0000',
  }
  const result = validateCreateFeedbackInput(probeInput)
  if (!result.ok) {
    return c.json({ error: 'validation failed', details: result.errors }, 400)
  }
  const input = result.value
  const row = await insertFeedback(getDb(), {
    recipeCode: code,
    beanId: undefined,
    ratings: input.ratings,
    actual: input.actual,
    comment: input.comment,
    rawComment: input.rawComment,
    quickTags: input.quickTags,
    desiredDirection: input.desiredDirection,
    nextHint: input.nextHint,
    source: input.source,
  })
  return c.json(row, 201)
})
