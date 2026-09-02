import { Hono } from 'hono'
import { getDb, getTasteSignals } from '@brewdial/db'
import { deriveTasteTarget, scoreBean, type BeanAttributes, type MatchBand, type TasteTarget } from '@brewdial/shared'

export const recommendations = new Hono()

const BAND_RANK: Record<MatchBand, number> = {
  great: 3,
  ok: 2,
  adventure: 1,
  unknown: 0,
}

type PickQuery = {
  acidity: number
  body: number
  roast: number
  decaf?: boolean
  seed?: number
}

type PickBeanRow = {
  id: string
  name: string | null
  roast_level_ord: number | null
  acidity: number | null
  body: number | null
  decaf: boolean | null
  flavor_categories: string[] | null
}

function parseInteger(value: string | undefined, label: string, required: boolean, details: string[]): number | undefined {
  if (value === undefined) {
    if (required) details.push(`${label} is required`)
    return undefined
  }
  // Number('1.5') is numeric, but choices and seeds intentionally accept integers only.
  if (!/^-?\d+$/.test(value)) {
    details.push(`${label} must be an integer`)
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    details.push(`${label} must be a safe integer`)
    return undefined
  }
  return parsed
}

function parsePickQuery(query: Record<string, string | undefined>): { value?: PickQuery; details: string[] } {
  const details: string[] = []
  const acidity = parseInteger(query.acidity, 'acidity', true, details)
  const body = parseInteger(query.body, 'body', true, details)
  const roast = parseInteger(query.roast, 'roast', true, details)
  const seed = parseInteger(query.seed, 'seed', false, details)

  for (const [label, value] of Object.entries({ acidity, body, roast })) {
    if (value !== undefined && (value < 1 || value > 5)) details.push(`${label} must be an integer from 1 to 5`)
  }

  let decaf: boolean | undefined
  if (query.decaf !== undefined) {
    if (query.decaf === 'true') decaf = true
    else if (query.decaf === 'false') decaf = false
    else details.push('decaf must be true or false')
  }

  if (details.length > 0 || acidity === undefined || body === undefined || roast === undefined) return { details }
  return { value: { acidity, body, roast, decaf, seed }, details }
}

function attrsFromBean(row: PickBeanRow): BeanAttributes {
  return {
    roastLevelOrd: row.roast_level_ord ?? undefined,
    acidity: row.acidity ?? undefined,
    body: row.body ?? undefined,
    decaf: row.decaf ?? undefined,
    flavorCategories: (row.flavor_categories ?? undefined) as BeanAttributes['flavorCategories'],
  }
}

function hasScorableAttributes(attrs: BeanAttributes): boolean {
  return attrs.acidity != null
    || attrs.body != null
    || attrs.roastLevelOrd != null
    || (attrs.flavorCategories?.length ?? 0) > 0
}

function questionSummary(target: TasteTarget): string {
  const parts = [
    target.acidity === 1 ? '저산미' : target.acidity === 3 ? '중간 산미' : '고산미',
    target.body === 1 ? '가벼운 바디' : target.body === 3 ? '미디엄 바디' : '풀바디',
    target.roast === 1 ? '라이트 로스팅' : target.roast === 3 ? '미디엄 로스팅' : '다크 로스팅',
  ]
  return parts.join(' · ')
}

// Mulberry32 is compact and stable across Node/browser engines, making a seed a
// usable contract-test oracle without affecting unseeded production draws.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    let value = (state += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function weightedPick<T>(items: T[], weightOf: (item: T) => number, random: () => number): T {
  // A zero-score `unknown` candidate remains selectable when it is the only
  // available band, while scored candidates retain their relative weight.
  const total = items.reduce((sum, item) => sum + Math.max(weightOf(item), 0.01), 0)
  let cursor = random() * total
  for (const item of items) {
    cursor -= Math.max(weightOf(item), 0.01)
    if (cursor < 0) return item
  }
  return items[items.length - 1]
}

// GET /recommendations/pick?acidity=1..5&body=1..5&roast=1..5&decaf=&seed=
// Deliberately outside /me: identity is an optional personalization enhancement,
// not an access requirement for the first-screen decision flow.
recommendations.get('/pick', async (c) => {
  const parsed = parsePickQuery(c.req.query())
  if (!parsed.value) return c.json({ error: 'validation failed', details: parsed.details }, 400)

  const db = getDb()
  const appUserId = c.get('appUserId') as string | undefined
  const signals = await getTasteSignals(db, appUserId)
  const derived = deriveTasteTarget({ ...signals, likes: [], dislikes: [] })
  // The session's explicit answers take precedence over inferred history.
  const tasteTarget: TasteTarget = {
    ...derived,
    acidity: parsed.value.acidity,
    body: parsed.value.body,
    roast: parsed.value.roast,
    summary: questionSummary({ ...derived, ...parsed.value }),
  }

  const rows = await db
    .selectFrom('beans')
    .select(['id', 'name', 'roast_level_ord', 'acidity', 'body', 'decaf', 'flavor_categories'])
    .orderBy('name', 'asc')
    .orderBy('id', 'asc')
    .execute() as PickBeanRow[]

  const candidates = rows
    .filter((row) => parsed.value!.decaf === undefined || row.decaf === parsed.value!.decaf)
    .map((row) => {
      const attrs = attrsFromBean(row)
      return { row, attrs, score: scoreBean(attrs, tasteTarget) }
    })
    // Free-text beans often have no structured attributes. They must never win
    // a first-screen recommendation, even as an `unknown` fallback.
    .filter(({ attrs }) => hasScorableAttributes(attrs))

  if (candidates.length === 0) return c.json({ bean: null, reason: 'no_attributed_beans' })

  const topRank = Math.max(...candidates.map((candidate) => BAND_RANK[candidate.score.band]))
  const topBand = candidates.filter((candidate) => BAND_RANK[candidate.score.band] === topRank)
  const random = parsed.value.seed === undefined ? Math.random : seededRandom(parsed.value.seed)
  const picked = weightedPick(topBand, (candidate) => candidate.score.score, random)

  const recipe = await db
    .selectFrom('recipes')
    .select(['code', 'title', 'created_by'])
    .where('bean_id', '=', picked.row.id)
    .where('status', '=', 'active')
    .where('owner_id', 'is', null)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  return c.json({
    bean: {
      id: picked.row.id,
      name: picked.row.name,
      roast_level_ord: picked.row.roast_level_ord,
      acidity: picked.row.acidity,
      body: picked.row.body,
      decaf: picked.row.decaf,
      flavor_categories: picked.row.flavor_categories ?? [],
    },
    band: picked.score.band,
    axes: picked.score.axes,
    why: picked.score.why,
    recipe: recipe
      ? { code: recipe.code, title: recipe.title, createdBy: recipe.created_by }
      : null,
    tasteTarget,
  })
})
