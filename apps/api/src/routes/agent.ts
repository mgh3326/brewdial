import { Hono } from 'hono'
import { getDb, insertAgentRecipe, getRecipeAnyStatus, updateRecipe, setRecipeStatus, supersedeRecipe, insertAgentFeedback, RecipeNotFoundError, getGlobalPreference, updateBeanAttributes } from '@brewdial/db'
import { validateCreateRecipeInput, validateUpdateBeanAttributesInput } from '@brewdial/shared'

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

// PATCH /agent/recipes/:code — update editable fields; version is bumped by 1
agentRouter.patch('/recipes/:code', async (c) => {
  const db = getDb()
  const code = c.req.param('code')
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid body' }, 400)

  // Strip guard-protected fields — server must never write these on update
  const { title, params, steps, notes, intent, beanSnapshot, adjustmentFromPrevious, dripperPortability } = body as Record<string, unknown>
  const patch = { title, params, steps, notes, intent, beanSnapshot, adjustmentFromPrevious, dripperPortability } as Parameters<typeof updateRecipe>[2]

  try {
    const row = await updateRecipe(db, code, patch)
    return c.json(row)
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') return c.json({ error: 'not found' }, 404)
    throw err
  }
})

// PATCH /agent/recipes/:code/status — set recipe status
agentRouter.patch('/recipes/:code/status', async (c) => {
  const db = getDb()
  const code = c.req.param('code')
  const body = await c.req.json().catch(() => null)
  const status = (body as Record<string, unknown> | null)?.status
  if (typeof status !== 'string') return c.json({ error: 'status is required' }, 400)

  const VALID = new Set(['active', 'archived', 'superseded', 'test'])
  if (!VALID.has(status)) return c.json({ error: 'invalid status', valid: ['active', 'archived', 'superseded', 'test'] }, 400)

  try {
    const row = await setRecipeStatus(db, code, status)
    return c.json(row)
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') return c.json({ error: 'not found' }, 404)
    if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'INVALID_STATUS') return c.json({ error: 'invalid status' }, 400)
    throw err
  }
})

// PATCH /agent/beans/:id — update a bean's structured attribute columns (ROB-654).
// Only normalized attribute columns are writable here; name/roaster/origin/process/
// roast_level/notes stay owned by recipe snapshots (find_or_create_bean). Inherits
// agentAuth via the /api/agent/* mount.
agentRouter.patch('/beans/:id', async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  const result = validateUpdateBeanAttributesInput(body)
  if (!result.ok) {
    return c.json({ error: 'validation failed', details: result.errors }, 400)
  }

  try {
    const row = await updateBeanAttributes(db, id, result.value)
    return c.json(row)
  } catch (err: unknown) {
    const code = err instanceof Error ? (err as NodeJS.ErrnoException & { code?: string }).code : undefined
    if (code === 'NOT_FOUND') return c.json({ error: 'not found' }, 404)
    // Merged-row range conflict (e.g. partial agtron patch) — clean 400, never a raw CHECK 500.
    if (code === 'INVALID_RANGE') return c.json({ error: 'validation failed', details: [err instanceof Error ? err.message : 'invalid range'] }, 400)
    throw err
  }
})

// POST /agent/feedback — agent submits feedback for a recipe
// source whitelist: {agent, mcp, coffee_profile, api}; default 'agent'.
const AGENT_FEEDBACK_SOURCES = new Set(['agent', 'mcp', 'coffee_profile', 'api'])

agentRouter.post('/feedback', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid body' }, 400)

  const b = body as Record<string, unknown>
  const recipeCode = b['recipeCode']
  if (typeof recipeCode !== 'string' || !recipeCode) {
    return c.json({ error: 'recipeCode is required' }, 400)
  }

  // Validate source if provided; default to 'agent'.
  const rawSource = b['source']
  if (rawSource !== undefined && !AGENT_FEEDBACK_SOURCES.has(rawSource as string)) {
    return c.json(
      { error: 'invalid source', valid: [...AGENT_FEEDBACK_SOURCES] },
      400,
    )
  }
  const source = (rawSource as string | undefined) ?? 'agent'

  const db = getDb()
  try {
    const row = await insertAgentFeedback(db, {
      recipeCode,
      source,
      beanId: b['beanId'] as string | undefined,
      ratings: b['ratings'],
      actual: b['actual'],
      comment: b['comment'] as string | undefined,
      rawComment: b['rawComment'] as string | undefined,
      quickTags: b['quickTags'] as string[] | undefined,
      desiredDirection: b['desiredDirection'] as string[] | undefined,
      nextHint: b['nextHint'] as string[] | undefined,
    })
    return c.json(row, 201)
  } catch (err: unknown) {
    if (err instanceof RecipeNotFoundError) return c.json({ error: 'recipe not found' }, 404)
    throw err
  }
})

// GET /agent/preferences/global — returns the singleton 'global' preferences row.
agentRouter.get('/preferences/global', async (c) => {
  const db = getDb()
  const row = await getGlobalPreference(db)
  return c.json(row ?? null)
})

// POST /agent/recipes/supersede — link old → new in a supersede relationship
agentRouter.post('/recipes/supersede', async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => null)
  const oldCode = (body as Record<string, unknown> | null)?.oldCode
  const newCode = (body as Record<string, unknown> | null)?.newCode
  if (typeof oldCode !== 'string' || typeof newCode !== 'string') {
    return c.json({ error: 'oldCode and newCode are required' }, 400)
  }

  // Self-supersede guard: a recipe cannot supersede itself.
  if (oldCode === newCode) {
    return c.json({ error: 'cannot supersede a recipe with itself' }, 400)
  }

  try {
    const result = await supersedeRecipe(db, oldCode, newCode)
    return c.json(result)
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') return c.json({ error: 'not found', detail: err.message }, 404)
    throw err
  }
})
