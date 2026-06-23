import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'

// Row shape matching the client mapper's RecipeRow
// (apps/miniapp/src/lib/data/mappers.ts — RecipeRow interface).
// Explicit type bounds Kysely inference and prevents TS2589.
export interface RecipeRow {
  id: string
  code: string
  method: string
  title: string
  version: number
  params: unknown
  steps: unknown
  bean_id: string | null
  bean_snapshot: unknown | null
  intent: string[] | null
  notes: string | null
  adjustment_from_previous: string | null
  created_by: string
  owner_id: string | null
  is_official: boolean
  dripper_portability: unknown | null
  status: string
  supersedes: string | null
  superseded_by: string | null
  parent_code: string | null
  created_at: Date
  updated_at: Date
}

// Exact columns the client mapper (RECIPE_COLUMNS in apps/miniapp/src/lib/data/mappers.ts) expects.
// Typed as ReadonlyArray<keyof DB['recipes']> (not `as const`) to prevent TS2589 depth explosion.
const RECIPE_COLS: ReadonlyArray<keyof DB['recipes']> = [
  'id',
  'code',
  'method',
  'title',
  'version',
  'params',
  'steps',
  'bean_id',
  'bean_snapshot',
  'intent',
  'notes',
  'adjustment_from_previous',
  'created_by',
  'owner_id',
  'is_official',
  'dripper_portability',
  'status',
  'supersedes',
  'superseded_by',
  'parent_code',
  'created_at',
  'updated_at',
]

export function listRecentRecipes(db: Kysely<DB>, limit = 20): Promise<RecipeRow[]> {
  const n = Math.min(100, Math.max(1, limit))
  return db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .limit(n)
    .execute() as unknown as Promise<RecipeRow[]>
}

export function getRecipeByCode(db: Kysely<DB>, code: string): Promise<RecipeRow | undefined> {
  return db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .where('code', '=', code)
    .where('status', '<>', 'test')
    .executeTakeFirst() as unknown as Promise<RecipeRow | undefined>
}

export function listRecipesByBean(db: Kysely<DB>, beanId: string): Promise<RecipeRow[]> {
  return db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .where('bean_id', '=', beanId)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .execute() as unknown as Promise<RecipeRow[]>
}

// ── Agent recipe functions ────────────────────────────────────────────────────

export interface InsertAgentRecipePayload {
  method: string
  title: string
  beanId?: string | null
  beanSnapshot?: unknown
  params?: unknown
  steps?: unknown
  intent?: string[]
  notes?: string
  adjustmentFromPrevious?: string
  dripperPortability?: unknown
}

/**
 * Insert a recipe on behalf of an agent. Runs inside a transaction that first
 * sets the `bd.owner_write_ok` session flag so the guard allows `created_by='agent'`.
 */
export async function insertAgentRecipe(
  db: Kysely<DB>,
  payload: InsertAgentRecipePayload
): Promise<RecipeRow> {
  return db.transaction().execute(async (trx) => {
    // Set the owner-write flag so the guard permits created_by='agent'.
    await sql`select set_config('bd.owner_write_ok','on',true)`.execute(trx)

    const values: Record<string, unknown> = {
      method: payload.method,
      title: payload.title,
      created_by: 'agent',
      version: 1,
      status: 'active',
      owner_id: null,
    }
    // Leave bean_id null when caller didn't supply one so the
    // recipes_link_bean BEFORE-INSERT trigger can link/dedup by bean_snapshot.
    if (payload.beanId != null) values.bean_id = payload.beanId
    if (payload.beanSnapshot !== undefined) values.bean_snapshot = payload.beanSnapshot as unknown
    if (payload.params !== undefined) values.params = payload.params as unknown
    if (payload.steps !== undefined) values.steps = payload.steps as unknown
    if (payload.intent !== undefined) values.intent = payload.intent
    if (payload.notes !== undefined) values.notes = payload.notes
    if (payload.adjustmentFromPrevious !== undefined)
      values.adjustment_from_previous = payload.adjustmentFromPrevious
    if (payload.dripperPortability !== undefined)
      values.dripper_portability = payload.dripperPortability as unknown

    return trx
      .insertInto('recipes')
      .values(values as Parameters<ReturnType<typeof trx.insertInto<'recipes'>>['values']>[0])
      .returning(RECIPE_COLS)
      .executeTakeFirstOrThrow() as unknown as Promise<RecipeRow>
  })
}

/**
 * Get a recipe by code with NO status filter — returns test/superseded rows too.
 * Used by agent-facing endpoints that need to read any-status recipes.
 */
export function getRecipeAnyStatus(db: Kysely<DB>, code: string): Promise<RecipeRow | undefined> {
  return db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .where('code', '=', code)
    .executeTakeFirst() as unknown as Promise<RecipeRow | undefined>
}

/**
 * List recent recipes with NO status filter — returns test/superseded rows too.
 * Clamps limit to 1..100.
 */
export function listRecentRecipesAnyStatus(db: Kysely<DB>, limit = 20): Promise<RecipeRow[]> {
  const n = Math.min(100, Math.max(1, limit))
  return db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .orderBy('created_at', 'desc')
    .limit(n)
    .execute() as unknown as Promise<RecipeRow[]>
}

export interface InsertManualRecipePayload {
  method: string
  title: string
  beanId?: string | null
  beanSnapshot?: unknown
  params?: unknown
  steps?: unknown
  intent?: string[]
  notes?: string
  adjustmentFromPrevious?: string
  dripperPortability?: unknown
}

// ── Agent recipe update / status / supersede ─────────────────────────────────

export interface UpdateRecipePatch {
  title?: string
  params?: unknown
  steps?: unknown
  notes?: string
  intent?: string[]
  beanSnapshot?: unknown
  adjustmentFromPrevious?: string
  dripperPortability?: unknown
}

/**
 * Update a recipe's editable fields and bump the version by 1.
 * NEVER writes owner_id / is_official / created_by (guard-protected columns).
 * Returns the updated RecipeRow, or throws if the code does not exist.
 */
export async function updateRecipe(
  db: Kysely<DB>,
  code: string,
  patch: UpdateRecipePatch
): Promise<RecipeRow> {
  const current = await getRecipeAnyStatus(db, code)
  if (!current) throw Object.assign(new Error(`recipe not found: ${code}`), { code: 'NOT_FOUND' })

  const set: Record<string, unknown> = {
    version: (current.version ?? 1) + 1,
  }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.params !== undefined) set.params = patch.params
  if (patch.steps !== undefined) set.steps = patch.steps
  if (patch.notes !== undefined) set.notes = patch.notes
  if (patch.intent !== undefined) set.intent = patch.intent
  if (patch.beanSnapshot !== undefined) set.bean_snapshot = patch.beanSnapshot
  if (patch.adjustmentFromPrevious !== undefined) set.adjustment_from_previous = patch.adjustmentFromPrevious
  if (patch.dripperPortability !== undefined) set.dripper_portability = patch.dripperPortability

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db.updateTable('recipes') as any)
    .set(set)
    .where('code', '=', code)
    .returning(RECIPE_COLS)
    .executeTakeFirst() as RecipeRow | undefined
  if (!row) throw Object.assign(new Error(`recipe not found: ${code}`), { code: 'NOT_FOUND' })
  return row
}

const VALID_STATUSES = new Set(['active', 'archived', 'superseded', 'test'])

/**
 * Set a recipe's status field. Allowed values: active | archived | superseded | test.
 * Returns the updated RecipeRow, or throws if the code does not exist.
 */
export async function setRecipeStatus(
  db: Kysely<DB>,
  code: string,
  status: string
): Promise<RecipeRow> {
  if (!VALID_STATUSES.has(status)) {
    throw Object.assign(new Error(`invalid status: ${status}`), { code: 'INVALID_STATUS' })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db.updateTable('recipes') as any)
    .set({ status })
    .where('code', '=', code)
    .returning(RECIPE_COLS)
    .executeTakeFirst() as RecipeRow | undefined
  if (!row) throw Object.assign(new Error(`recipe not found: ${code}`), { code: 'NOT_FOUND' })
  return row
}

/**
 * Link two recipes in a supersede relationship inside a single transaction:
 *   old.status = 'superseded', old.superseded_by = newCode
 *   new.supersedes = oldCode
 * Returns { old: RecipeRow, replacement: RecipeRow }.
 * Throws (code NOT_FOUND) if either code does not exist.
 */
export async function supersedeRecipe(
  db: Kysely<DB>,
  oldCode: string,
  newCode: string
): Promise<{ old: RecipeRow; replacement: RecipeRow }> {
  return db.transaction().execute(async (trx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldRow = await (trx.updateTable('recipes') as any)
      .set({ status: 'superseded', superseded_by: newCode })
      .where('code', '=', oldCode)
      .returning(RECIPE_COLS)
      .executeTakeFirst() as RecipeRow | undefined
    if (!oldRow) throw Object.assign(new Error(`recipe not found: ${oldCode}`), { code: 'NOT_FOUND' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newRow = await (trx.updateTable('recipes') as any)
      .set({ supersedes: oldCode })
      .where('code', '=', newCode)
      .returning(RECIPE_COLS)
      .executeTakeFirst() as RecipeRow | undefined
    if (!newRow) throw Object.assign(new Error(`recipe not found: ${newCode}`), { code: 'NOT_FOUND' })

    return { old: oldRow, replacement: newRow }
  })
}

export function insertManualRecipe(
  db: Kysely<DB>,
  payload: InsertManualRecipePayload
): Promise<RecipeRow> {
  const values: Record<string, unknown> = {
    method: payload.method,
    title: payload.title,
    created_by: 'manual',
    version: 1,
    status: 'active',
  }
  // Leave bean_id null when client didn't supply one so the
  // recipes_link_bean BEFORE-INSERT trigger can link/dedup by bean_snapshot.
  if (payload.beanId != null) values.bean_id = payload.beanId
  if (payload.beanSnapshot !== undefined) values.bean_snapshot = payload.beanSnapshot as unknown
  if (payload.params !== undefined) values.params = payload.params as unknown
  if (payload.steps !== undefined) values.steps = payload.steps as unknown
  if (payload.intent !== undefined) values.intent = payload.intent
  if (payload.notes !== undefined) values.notes = payload.notes
  if (payload.adjustmentFromPrevious !== undefined)
    values.adjustment_from_previous = payload.adjustmentFromPrevious
  if (payload.dripperPortability !== undefined)
    values.dripper_portability = payload.dripperPortability as unknown

  return db
    .insertInto('recipes')
    .values(values as Parameters<ReturnType<typeof db.insertInto<'recipes'>>['values']>[0])
    .returning(RECIPE_COLS)
    .executeTakeFirstOrThrow() as unknown as Promise<RecipeRow>
}
