import { Hono } from 'hono'
import { getDb, insertAgentRecipe, getRecipeAnyStatus, updateRecipe, setRecipeStatus, supersedeRecipe } from '@brewdial/db'
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

// POST /agent/recipes/supersede — link old → new in a supersede relationship
agentRouter.post('/recipes/supersede', async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => null)
  const oldCode = (body as Record<string, unknown> | null)?.oldCode
  const newCode = (body as Record<string, unknown> | null)?.newCode
  if (typeof oldCode !== 'string' || typeof newCode !== 'string') {
    return c.json({ error: 'oldCode and newCode are required' }, 400)
  }

  try {
    const result = await supersedeRecipe(db, oldCode, newCode)
    return c.json(result)
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') return c.json({ error: 'not found', detail: err.message }, 404)
    throw err
  }
})
