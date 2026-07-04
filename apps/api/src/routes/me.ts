import { Hono } from 'hono'
import { getDb, saveRecipe, saveBean, upsertGear, upsertCalibration, listBeans, getTasteSignals, getGlobalPreference, setGlobalPreference } from '@brewdial/db'
import { deriveTasteTarget, scoreBean, validateUpdatePreferencesInput, type BeanAttributes } from '@brewdial/shared'
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

// GET /me/recommendations — read-time taste target + per-bean match bands.
// Identity OPTIONAL: uses the caller's saved/rated beans when present, else global only.
me.get('/recommendations', async (c) => {
  const db = getDb()
  const appUserId = c.get('appUserId') as string | undefined
  const [signals, prefs, beans] = await Promise.all([
    getTasteSignals(db, appUserId),
    getGlobalPreference(db),
    listBeans(db),
  ])
  const target = deriveTasteTarget({
    savedBeanAttrs: signals.savedBeanAttrs,
    ratedBeanAttrs: signals.ratedBeanAttrs,
    likes: prefs?.likes ?? [],
    dislikes: prefs?.dislikes ?? [],
  })
  const scores: Record<string, ReturnType<typeof scoreBean>> = {}
  for (const b of beans) {
    if (!b.id) continue
    const attrs: BeanAttributes = {
      roastLevelOrd: b.roast_level_ord ?? undefined,
      agtronMin: b.agtron_min ?? undefined,
      agtronMax: b.agtron_max ?? undefined,
      acidity: b.acidity ?? undefined,
      body: b.body ?? undefined,
      decaf: b.decaf ?? undefined,
      flavorCategories: (b.flavor_categories ?? undefined) as BeanAttributes['flavorCategories'],
      attrsSource: (b.attrs_source ?? undefined) as BeanAttributes['attrsSource'],
    }
    scores[b.id] = scoreBean(attrs, target)
  }
  const rankScore = { great: 3, ok: 2, adventure: 1, unknown: 0 } as const
  const ranked = Object.entries(scores)
    .sort((a, b) => (rankScore[b[1].band] - rankScore[a[1].band]) || (b[1].score - a[1].score))
    .map(([id]) => id)
  // Strip the internal `score` float from the response — scoreBean documents it as
  // "0..1 internal, NOT rendered"; leaking it would put a decimal in the JSON (no-decimals rule).
  const bands: Record<string, { band: (typeof scores)[string]['band']; axes: (typeof scores)[string]['axes']; why: string }> = {}
  for (const [id, s] of Object.entries(scores)) bands[id] = { band: s.band, axes: s.axes, why: s.why }
  return c.json({
    tasteProfile: {
      targets: { acidity: target.acidity, body: target.body, roast: target.roast },
      flavorAffinity: target.flavorAffinity,
      penalize: target.penalize,
      confidence: target.confidence,
      summary: target.summary,
      evidence: target.evidence,
    },
    bands,
    ranked,
  })
})

// PUT /me/gear — upsert a piece of gear (grinder or dripper)
// PUT /me/preferences — edit the global taste tags (S1 global singleton).
me.put('/preferences', async (c) => {
  const body = await c.req.json().catch(() => null)
  const result = validateUpdatePreferencesInput(body)
  if (!result.ok) return c.json({ error: 'validation failed', details: result.errors }, 400)
  const row = await setGlobalPreference(getDb(), result.value)
  return c.json({ likes: row.likes, dislikes: row.dislikes })
})
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
