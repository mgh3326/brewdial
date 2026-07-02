import { Hono } from 'hono'
import { getDb, listFeedbackByRecipe, insertFeedback, getRecipeByCode } from '@brewdial/db'
import { validateCreateFeedbackInput } from '@brewdial/shared'

export const feedback = new Hono()

// Allowed sources for anonymous public feedback. Agent/mcp/api sources arrive
// via /api/agent/* (M4+) and must not be self-declared by anon callers here.
const ANON_ALLOWED_SOURCES = new Set(['web', 'coffee_profile'])

// GET /recipes/:code/feedback
feedback.get('/:code/feedback', async (c) => {
  const db = getDb()
  const code = c.req.param('code')
  const appUserId = c.get('appUserId') as string | undefined
  // Visibility gate (ROB-642 C2): private recipes only resolve for their owner.
  const recipe = await getRecipeByCode(db, code, appUserId)
  if (!recipe) return c.json({ error: 'recipe not found' }, 404)
  const rows = await listFeedbackByRecipe(db, code)
  return c.json(rows)
})

// POST /recipes/:code/feedback
feedback.post('/:code/feedback', async (c) => {
  const code = c.req.param('code')
  const body = await c.req.json().catch(() => null)

  // Fix 1: Restrict source to anon-allowed values. Default absent source to
  // 'web'; reject any source outside {web, coffee_profile} with 400.
  const rawSource = body && typeof body === 'object' ? (body as Record<string, unknown>).source : undefined
  if (rawSource !== undefined && !ANON_ALLOWED_SOURCES.has(rawSource as string)) {
    return c.json(
      { error: 'invalid source', details: [`source must be one of: ${[...ANON_ALLOWED_SOURCES].join(', ')}`] },
      400
    )
  }
  const effectiveSource = (rawSource as string | undefined) ?? 'web'

  // Fix 2: Pre-check recipe exists to return 404 instead of an FK 500.
  // ROB-642 C2: owner-scoped visibility — private recipes 404 for non-owners/anon.
  const db = getDb()
  const appUserId = c.get('appUserId') as string | undefined
  const recipe = await getRecipeByCode(db, code, appUserId)
  if (!recipe) {
    return c.json({ error: 'recipe not found' }, 404)
  }

  // Use a synthetic COF-0000 recipeCode placeholder so the shared validator can
  // check all content fields; the actual recipe_code written to the DB always
  // comes from the path param, never from the body.
  const probeInput = {
    ...(body && typeof body === 'object' ? body : {}),
    recipeCode: 'COF-0000',
    source: effectiveSource,
  }
  const result = validateCreateFeedbackInput(probeInput)
  if (!result.ok) {
    return c.json({ error: 'validation failed', details: result.errors }, 400)
  }
  const input = result.value
  const row = await insertFeedback(db, {
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
