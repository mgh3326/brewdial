import { Hono } from 'hono'
import { getDb, saveRecipe, saveBean, upsertGear, upsertCalibration } from '@brewdial/db'
import { requireIdentity } from '../middleware/identity.js'
import { getMyCollections } from '../services/collections.js'
import type { GearInput, CalibrationInput } from '@brewdial/db'

export const me = new Hono()

// All /me routes require identity (scoped by appUserId from c.get('appUserId')).

// POST /me/saved-recipes — bookmark a recipe by code
me.post('/saved-recipes', requireIdentity, async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.code !== 'string') {
    return c.json({ error: 'code required' }, 400)
  }
  const appUserId = c.get('appUserId') as string
  await saveRecipe(getDb(), appUserId, body.code)
  return c.json({ ok: true }, 201)
})

// POST /me/saved-beans — bookmark a bean by id
me.post('/saved-beans', requireIdentity, async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.beanId !== 'string') {
    return c.json({ error: 'beanId required' }, 400)
  }
  const appUserId = c.get('appUserId') as string
  await saveBean(getDb(), appUserId, body.beanId)
  return c.json({ ok: true }, 201)
})

// GET /me/collections — composite saved content for the user
me.get('/collections', requireIdentity, async (c) => {
  const appUserId = c.get('appUserId') as string
  const collections = await getMyCollections(getDb(), appUserId)
  return c.json(collections)
})

// PUT /me/gear — upsert a piece of gear (grinder or dripper)
me.put('/gear', requireIdentity, async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || !body.kind || !body.label) {
    return c.json({ error: 'kind and label required' }, 400)
  }
  const appUserId = c.get('appUserId') as string
  const gear: GearInput = {
    kind: body.kind,
    label: body.label,
    grinderId: body.grinderId ?? null,
    dripperId: body.dripperId ?? null,
    details: body.details,
    isDefault: body.isDefault ?? false,
  }
  const id = await upsertGear(getDb(), appUserId, gear)
  return c.json({ ok: true, id })
})

// PUT /me/calibration — upsert a grinder-pair calibration
me.put('/calibration', requireIdentity, async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || !body.fromLabel || !body.toLabel) {
    return c.json({ error: 'fromLabel and toLabel required' }, 400)
  }
  const appUserId = c.get('appUserId') as string
  const cal: CalibrationInput = {
    fromLabel: body.fromLabel,
    toLabel: body.toLabel,
    // Fix 3: coerce empty strings to null (mirrors old RPC nullif(...,'')::uuid).
    anchorMethod: body.anchorMethod || null,
    fromGrinderId: body.fromGrinderId || null,
    toGrinderId: body.toGrinderId || null,
    samples: body.samples ?? [],
    source: body.source ?? 'measured',
    notes: body.notes ?? null,
  }
  const id = await upsertCalibration(getDb(), appUserId, cal)
  return c.json({ ok: true, id })
})
