import { Hono } from 'hono'
import { getDb, insertAgentRecipe, getRecipeAnyStatus } from '@brewdial/db'
import { validateCreateRecipeInput } from '@brewdial/shared'

export const agentRouter = new Hono()

// POST /agent/recipes — agent creates a recipe
// Server hard-codes created_by='agent', owner_id=null, is_official=false, version=1, status='active'.
// Any owner_id / is_official / created_by values in the body are silently stripped.
agentRouter.post('/recipes', async (c) => {
  const body = await c.req.json().catch(() => null)
  const result = validateCreateRecipeInput(body)
  if (!result.ok) {
    return c.json({ error: 'validation failed', details: result.errors }, 400)
  }
  const input = result.value
  // Strip owner_id / is_official / created_by — server always controls these.
  const row = await insertAgentRecipe(getDb(), {
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

// GET /agent/recipes/:code — returns a recipe of ANY status (test, superseded, active, etc.)
agentRouter.get('/recipes/:code', async (c) => {
  const db = getDb()
  const code = c.req.param('code')
  const row = await getRecipeAnyStatus(db, code)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})
