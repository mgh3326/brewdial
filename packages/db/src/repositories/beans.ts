import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'

// Row shape matching the client mapper's BeanSummaryRow
// (apps/miniapp/src/lib/data/beans.ts — BeanSummaryRow interface).
// Explicit type bounds Kysely inference and prevents TS2589.
export interface BeanRow {
  id: string | null
  name: string | null
  roaster: string | null
  origin: string | null
  process: string | null
  roast_level: string | null
  notes: string | null
  recipe_count: string | null  // Int8 comes back as string from pg
  latest_recipe_at: Date | null
  has_ai: boolean | null
  // ROB-654 structured attributes (nullable; agent-written)
  roast_level_ord: number | null
  agtron_min: number | null
  agtron_max: number | null
  acidity: number | null
  body: number | null
  decaf: boolean | null
  flavor_categories: string[] | null
  attrs_source: string | null
  source_url: string | null
  attrs_notes: string | null
}

// Exact columns the client mapper (BEAN_COLUMNS in apps/miniapp/src/lib/data/beans.ts) expects.
// Typed as ReadonlyArray<keyof DB['bean_summaries']> (not `as const`) to prevent TS2589 depth explosion.
const BEAN_COLS: ReadonlyArray<keyof DB['bean_summaries']> = [
  'id',
  'name',
  'roaster',
  'origin',
  'process',
  'roast_level',
  'notes',
  'recipe_count',
  'latest_recipe_at',
  'has_ai',
  'roast_level_ord',
  'agtron_min',
  'agtron_max',
  'acidity',
  'body',
  'decaf',
  'flavor_categories',
  'attrs_source',
  'source_url',
  'attrs_notes',
]

export function listBeans(db: Kysely<DB>): Promise<BeanRow[]> {
  return db
    .selectFrom('bean_summaries')
    .select(BEAN_COLS)
    // ROB-1291: attribute-bearing beans (Kurly catalog backfill) are listable even
    // before their first recipe — visible = has recipes OR has structured attrs.
    .where((eb) => eb.or([
      eb('recipe_count', '>', '0'),
      eb('attrs_source', 'is not', null),
    ]))
    // DESC alone puts NULLs FIRST in Postgres — recipe-less (attr-only) beans would
    // flood the top of the list. Force them below, then stable name order.
    .orderBy(sql`latest_recipe_at desc nulls last`)
    .orderBy('name', 'asc')
    .execute() as unknown as Promise<BeanRow[]>
}

export function findBeans(db: Kysely<DB>, q: string, limit?: number): Promise<BeanRow[]> {
  // Default limit 10 to match MCP find_bean disambiguation order.
  // Intentional divergence: we cap at 25 (MCP has no max); callers should not rely on >25 rows.
  const clampedLimit = Math.min(25, Math.max(1, limit ?? 10))
  const pattern = `%${q.trim()}%`
  return db
    .selectFrom('bean_summaries')
    .select(BEAN_COLS)
    .where((eb) => eb.or([
      eb('name', 'ilike', pattern),
      eb('roaster', 'ilike', pattern),
    ]))
    // ROB-1291: same visibility rule as listBeans — recipes OR structured attrs.
    .where((eb) => eb.or([
      eb('recipe_count', '>', '0'),
      eb('attrs_source', 'is not', null),
    ]))
    // MCP disambiguation order: most-used beans first (recipe_count DESC).
    // recipe_count is stored as Int8/string; ORDER BY works correctly at the DB level.
    // Attr-only beans (count 0) sort last; name tiebreak keeps order deterministic.
    .orderBy('recipe_count', 'desc')
    .orderBy('name', 'asc')
    .limit(clampedLimit)
    .execute() as unknown as Promise<BeanRow[]>
}

export function getBean(db: Kysely<DB>, id: string): Promise<BeanRow | undefined> {
  return db
    .selectFrom('bean_summaries')
    .select(BEAN_COLS)
    .where('id', '=', id)
    .executeTakeFirst() as unknown as Promise<BeanRow | undefined>
}

// ROB-654: agent-writable structured attributes on the shared `beans` registry.
// Only these normalized columns are writable here — name/roaster/origin/process/
// roast_level/notes stay owned by recipe snapshots via find_or_create_bean.
export interface UpdateBeanAttributesPatch {
  roastLevelOrd?: number | null
  agtronMin?: number | null
  agtronMax?: number | null
  acidity?: number | null
  body?: number | null
  decaf?: boolean | null
  flavorCategories?: string[] | null
  attrsSource?: string | null
  sourceUrl?: string | null
  attrsNotes?: string | null
}

/**
 * Update a bean's structured attribute columns (ROB-654). Writes the base `beans`
 * table (not the bean_summaries view). Returns the enriched BeanRow read back from
 * bean_summaries. Throws { code: 'NOT_FOUND' } if the id does not exist.
 */
export async function updateBeanAttributes(
  db: Kysely<DB>,
  id: string,
  patch: UpdateBeanAttributesPatch
): Promise<BeanRow> {
  const existing = await db
    .selectFrom('beans')
    .select(['id', 'agtron_min', 'agtron_max'])
    .where('id', '=', id)
    .executeTakeFirst()
  if (!existing) throw Object.assign(new Error(`bean not found: ${id}`), { code: 'NOT_FOUND' })

  // Stateful cross-column guard: beans_agtron_chk (agtron_max >= agtron_min) is
  // evaluated by the DB against the MERGED row, but the stateless validator only
  // cross-checks when BOTH bounds arrive in the same request. A partial patch of
  // one bound that inverts the stored counterpart would otherwise leak the raw
  // CHECK violation (SQLSTATE 23514) as a 500 — reject it as a typed 400 instead.
  const effAgtronMin = patch.agtronMin !== undefined ? patch.agtronMin : existing.agtron_min
  const effAgtronMax = patch.agtronMax !== undefined ? patch.agtronMax : existing.agtron_max
  if (effAgtronMin != null && effAgtronMax != null && effAgtronMax < effAgtronMin) {
    throw Object.assign(
      new Error(`agtronMax (${effAgtronMax}) must be >= agtronMin (${effAgtronMin})`),
      { code: 'INVALID_RANGE' }
    )
  }

  const set: Record<string, unknown> = {}
  if (patch.roastLevelOrd !== undefined) set.roast_level_ord = patch.roastLevelOrd
  if (patch.agtronMin !== undefined) set.agtron_min = patch.agtronMin
  if (patch.agtronMax !== undefined) set.agtron_max = patch.agtronMax
  if (patch.acidity !== undefined) set.acidity = patch.acidity
  if (patch.body !== undefined) set.body = patch.body
  if (patch.decaf !== undefined) set.decaf = patch.decaf
  if (patch.flavorCategories !== undefined) set.flavor_categories = patch.flavorCategories
  if (patch.attrsSource !== undefined) set.attrs_source = patch.attrsSource
  if (patch.sourceUrl !== undefined) set.source_url = patch.sourceUrl
  if (patch.attrsNotes !== undefined) set.attrs_notes = patch.attrsNotes

  if (Object.keys(set).length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.updateTable('beans') as any)
      .set(set)
      .where('id', '=', id)
      .execute()
  }

  const row = await getBean(db, id)
  if (!row) throw Object.assign(new Error(`bean not found: ${id}`), { code: 'NOT_FOUND' })
  return row
}

// ── identity resync ──────────────────────────────────────────────────────────
// find_or_create_bean() only runs on the recipes BEFORE INSERT trigger, so
// correcting an existing recipe's bean_snapshot leaves the shared beans row
// stale — and BeanCard/BeanDetail render beans.origin, not the snapshot. This
// re-derives the non-key identity fields from the newest snapshot.
//
// name/roaster are deliberately NOT resynced: they form the
// beans_name_roaster_key unique index, so rewriting them could collide with
// another bean. A rename is a merge, not a resync.
//
// Source snapshot is restricted to PUBLIC recipes (owner_id is null) so a
// private recipe's snapshot text can never leak onto the shared bean card —
// same filter bean_summaries uses for its aggregates (004_owner_privacy).

export interface ResyncBeanIdentityResult {
  bean: BeanRow
  sourceRecipeCode: string | null
  changed: string[]
}

const RESYNC_FIELDS = [
  { col: 'origin', snapKey: 'origin' },
  { col: 'process', snapKey: 'process' },
  { col: 'roast_level', snapKey: 'roastLevel' },
  { col: 'notes', snapKey: 'notes' },
] as const

export async function resyncBeanIdentity(
  db: Kysely<DB>,
  id: string
): Promise<ResyncBeanIdentityResult> {
  const existing = await db
    .selectFrom('beans')
    .select(['id', 'origin', 'process', 'roast_level', 'notes'])
    .where('id', '=', id)
    .executeTakeFirst()
  if (!existing) throw Object.assign(new Error(`bean not found: ${id}`), { code: 'NOT_FOUND' })

  const source = await db
    .selectFrom('recipes')
    .select(['code', 'bean_snapshot'])
    .where('bean_id', '=', id)
    .where('bean_snapshot', 'is not', null)
    .where('owner_id', 'is', null)
    .orderBy('updated_at', 'desc')
    .executeTakeFirst()

  if (!source) {
    const bean = await getBean(db, id)
    if (!bean) throw Object.assign(new Error(`bean not found: ${id}`), { code: 'NOT_FOUND' })
    return { bean, sourceRecipeCode: null, changed: [] }
  }

  // jsonb comes back parsed from pg, but tolerate a string in case a driver
  // or a hand-written row stored it as text.
  const raw = source.bean_snapshot as unknown
  let snap: Record<string, unknown>
  try {
    snap = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
  } catch {
    snap = {}
  }
  if (snap === null || typeof snap !== 'object') snap = {}

  // coalesce semantics, matching find_or_create_bean: a snapshot field that is
  // absent/null/blank never blanks out a value already on the bean.
  const set: Record<string, unknown> = {}
  const changed: string[] = []
  for (const { col, snapKey } of RESYNC_FIELDS) {
    const next = snap[snapKey]
    if (typeof next !== 'string') continue
    const trimmed = next.trim()
    if (trimmed === '') continue
    if (trimmed === (existing as Record<string, unknown>)[col]) continue
    set[col] = trimmed
    changed.push(col)
  }

  if (changed.length > 0) {
    set.updated_at = new Date()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.updateTable('beans') as any).set(set).where('id', '=', id).execute()
  }

  const bean = await getBean(db, id)
  if (!bean) throw Object.assign(new Error(`bean not found: ${id}`), { code: 'NOT_FOUND' })
  return { bean, sourceRecipeCode: source.code, changed }
}

// ── purchase links ───────────────────────────────────────────────────────────
// The table shipped in 001 as forward-compat with no read/write path; these are
// its first callers. Writes are agent-only (mounted under /agent), reads public.

export interface BeanPurchaseLinkRow {
  id: string
  bean_id: string
  vendor: string
  url: string
  link_category: string
  price_krw: number | null
  is_affiliate: boolean
  active: boolean
  sort_order: number
}

const PURCHASE_LINK_COLS: ReadonlyArray<keyof DB['bean_purchase_links']> = [
  'id',
  'bean_id',
  'vendor',
  'url',
  'link_category',
  'price_krw',
  'is_affiliate',
  'active',
  'sort_order',
]

export function listBeanPurchaseLinks(
  db: Kysely<DB>,
  beanId: string
): Promise<BeanPurchaseLinkRow[]> {
  return db
    .selectFrom('bean_purchase_links')
    .select(PURCHASE_LINK_COLS)
    .where('bean_id', '=', beanId)
    .where('active', '=', true)
    .orderBy('sort_order', 'asc')
    .execute() as unknown as Promise<BeanPurchaseLinkRow[]>
}

export interface InsertBeanPurchaseLinkInput {
  beanId: string
  vendor: string
  url: string
  linkCategory?: string
  priceKrw?: number | null
  isAffiliate?: boolean
  sortOrder?: number
}

export async function insertBeanPurchaseLink(
  db: Kysely<DB>,
  input: InsertBeanPurchaseLinkInput
): Promise<BeanPurchaseLinkRow> {
  const bean = await db
    .selectFrom('beans')
    .select('id')
    .where('id', '=', input.beanId)
    .executeTakeFirst()
  if (!bean) {
    throw Object.assign(new Error(`bean not found: ${input.beanId}`), { code: 'NOT_FOUND' })
  }

  const values: Record<string, unknown> = {
    bean_id: input.beanId,
    vendor: input.vendor,
    url: input.url,
  }
  if (input.linkCategory !== undefined) values.link_category = input.linkCategory
  if (input.priceKrw !== undefined) values.price_krw = input.priceKrw
  if (input.isAffiliate !== undefined) values.is_affiliate = input.isAffiliate
  if (input.sortOrder !== undefined) values.sort_order = input.sortOrder

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db.insertInto('bean_purchase_links') as any)
    .values(values)
    .returning(PURCHASE_LINK_COLS)
    .executeTakeFirst() as BeanPurchaseLinkRow | undefined
  if (!row) throw new Error('failed to insert bean purchase link')
  return row
}
