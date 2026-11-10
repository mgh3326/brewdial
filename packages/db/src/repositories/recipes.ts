import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'
import { withOwnerWrites } from '../owner-writes.js'
import { dbVendor } from '../db.js'
import type { RecipeParamsPatch } from '@brewdial/shared'

// pg serializes a top-level JS array as a Postgres array literal (e.g. `steps` -> `{...}`),
// which a jsonb column rejects (22P02 "invalid input syntax for type json"). JSON-serialize
// jsonb values so they reach the column as parseable JSON text. null/undefined pass through
// (SQL NULL / omitted). Only for jsonb columns — text[] columns like `intent` keep their JS
// array (pg's array literal is correct there).
function asJsonb(v: unknown): unknown {
  return v === null || v === undefined ? v : JSON.stringify(v)
}

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
    .where('owner_id', 'is', null)
    .orderBy('created_at', 'desc')
    .limit(n)
    .execute() as unknown as Promise<RecipeRow[]>
}

export function getRecipeByCode(
  db: Kysely<DB>,
  code: string,
  callerAppUserId?: string
): Promise<RecipeRow | undefined> {
  let q = db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .where('code', '=', code)
    .where('status', 'not in', ['test', 'reference'])
  if (callerAppUserId) {
    q = q.where((eb) => eb.or([eb('owner_id', 'is', null), eb('owner_id', '=', callerAppUserId)]))
  } else {
    q = q.where('owner_id', 'is', null)
  }
  return q.executeTakeFirst() as unknown as Promise<RecipeRow | undefined>
}

export function listRecipesByBean(
  db: Kysely<DB>,
  beanId: string,
  callerAppUserId?: string
): Promise<RecipeRow[]> {
  let q = db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .where('bean_id', '=', beanId)
    .where('status', '=', 'active')
  if (callerAppUserId) {
    q = q.where((eb) => eb.or([eb('owner_id', 'is', null), eb('owner_id', '=', callerAppUserId)]))
  } else {
    q = q.where('owner_id', 'is', null)
  }
  return q.orderBy('created_at', 'desc').execute() as unknown as Promise<RecipeRow[]>
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
  parentCode?: string
}

/**
 * Insert a recipe on behalf of an agent. Runs inside a transaction that first
 * enables the owner-write guard for the duration of the transaction.
 */
export async function insertAgentRecipe(
  db: Kysely<DB>,
  payload: InsertAgentRecipePayload
): Promise<RecipeRow> {
  return withOwnerWrites(db, async (trx) => {
    const id = crypto.randomUUID()

    const values: Record<string, unknown> = {
      method: payload.method,
      title: payload.title,
      created_by: 'agent',
      version: 1,
      status: 'active',
      owner_id: null,
      id,
    }
    // Leave bean_id null when caller didn't supply one so the
    // recipes_link_bean BEFORE-INSERT trigger can link/dedup by bean_snapshot.
    if (payload.beanId != null) values.bean_id = payload.beanId
    if (payload.beanSnapshot !== undefined) values.bean_snapshot = asJsonb(payload.beanSnapshot)
    if (payload.params !== undefined) values.params = asJsonb(payload.params)
    if (payload.steps !== undefined) values.steps = asJsonb(payload.steps)
    if (payload.intent !== undefined) values.intent = dbVendor() === 'mysql' ? JSON.stringify(payload.intent) : payload.intent
    if (payload.notes !== undefined) values.notes = payload.notes
    if (payload.adjustmentFromPrevious !== undefined)
      values.adjustment_from_previous = payload.adjustmentFromPrevious
    if (payload.dripperPortability !== undefined)
      values.dripper_portability = asJsonb(payload.dripperPortability)
    if (payload.parentCode !== undefined) values.parent_code = payload.parentCode

    await trx
      .insertInto('recipes')
      .values(values as Parameters<ReturnType<typeof trx.insertInto<'recipes'>>['values']>[0])
      .execute()
    return await trx.selectFrom('recipes').select(RECIPE_COLS).where('id', '=', id)
      .executeTakeFirstOrThrow() as unknown as RecipeRow
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

export function listRecipeChildren(db: Kysely<DB>, parentCode: string): Promise<RecipeRow[]> {
  return db.selectFrom('recipes').select(RECIPE_COLS).where('parent_code', '=', parentCode)
    .orderBy('created_at', 'asc').execute() as unknown as Promise<RecipeRow[]>
}

export async function setRecipeParent(db: Kysely<DB>, code: string, parentCode: string | null): Promise<RecipeRow> {
  return db.transaction().execute(async (trx) => {
    const recipe = await trx.selectFrom('recipes').select(RECIPE_COLS).where('code', '=', code).forUpdate().executeTakeFirst() as unknown as RecipeRow | undefined
    if (!recipe) throw Object.assign(new Error('recipe not found'), { code: 'NOT_FOUND' })
    if (parentCode !== null) {
      if (parentCode === code) throw Object.assign(new Error('parent cannot equal recipe'), { code: 'INVALID_PARENT' })
      let cursor: string | null = parentCode
      const visited = new Set<string>()
      for (let step = 0; cursor !== null; step += 1) {
        if (step >= 50) throw Object.assign(new Error('parent chain exceeds 50 steps'), { code: 'INVALID_PARENT' })
        if (cursor === code || visited.has(cursor)) throw Object.assign(new Error('parent would create a cycle'), { code: 'INVALID_PARENT' })
        visited.add(cursor)
        const ancestor = await trx.selectFrom('recipes').select(['code', 'parent_code']).where('code', '=', cursor).forUpdate().executeTakeFirst()
        if (!ancestor) throw Object.assign(new Error('parent not found'), { code: 'PARENT_NOT_FOUND' })
        cursor = ancestor.parent_code
      }
    }
    await (trx.updateTable('recipes') as any).set({ parent_code: parentCode }).where('code', '=', code).execute()
    return await trx.selectFrom('recipes').select(RECIPE_COLS).where('code', '=', code).executeTakeFirstOrThrow() as unknown as RecipeRow
  })
}

export interface InsertManualRecipePayload {
  method: string
  title: string
  ownerId?: string | null
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
  params?: RecipeParamsPatch
  steps?: unknown
  notes?: string
  intent?: string[]
  beanSnapshot?: unknown
  adjustmentFromPrevious?: string
  dripperPortability?: unknown
}

export interface UpdateRecipeOptions {
  /** The version the caller last read. A different stored version → VERSION_CONFLICT, nothing written. */
  expectedVersion?: number
  /** Return before/after/changed and write nothing (no version bump). */
  dryRun?: boolean
}

export type UpdateRecipeResult =
  | { kind: 'updated'; row: RecipeRow }
  | { kind: 'dryRun'; before: RecipeRow; after: RecipeRow; changed: string[] }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Stable JSON for comparing stored and patched values (jsonb does not keep key order).
function canonical(v: unknown): string | undefined {
  return JSON.stringify(v, (_key, val: unknown) =>
    isRecord(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val
  )
}

// Params merge by top-level key: present keys replace, null removes, absent keys keep the
// stored value (including legacy keys the validator does not know). A non-object patch is
// written as-is, as before.
function mergeParams(stored: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch
  const merged: Record<string, unknown> = isRecord(stored) ? { ...stored } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key]
    else if (value !== undefined) merged[key] = value
  }
  return merged
}

function paramValue(params: unknown, key: string): unknown {
  return isRecord(params) ? params[key] : undefined
}

// The row as it would be after the patch (no write, version unchanged).
function applyPatch(current: RecipeRow, patch: UpdateRecipePatch): RecipeRow {
  return {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.params !== undefined ? { params: mergeParams(current.params, patch.params) } : {}),
    ...(patch.steps !== undefined ? { steps: patch.steps } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.intent !== undefined ? { intent: patch.intent } : {}),
    ...(patch.beanSnapshot !== undefined ? { bean_snapshot: patch.beanSnapshot } : {}),
    ...(patch.adjustmentFromPrevious !== undefined ? { adjustment_from_previous: patch.adjustmentFromPrevious } : {}),
    ...(patch.dripperPortability !== undefined ? { dripper_portability: patch.dripperPortability } : {}),
  }
}

// Field names use the PATCH body's spelling; params entries are reported as params.<key>.
function changedFields(before: RecipeRow, after: RecipeRow, patch: UpdateRecipePatch): string[] {
  const changed: string[] = []
  const check = (name: string, column: keyof RecipeRow) => {
    if (canonical(before[column]) !== canonical(after[column])) changed.push(name)
  }
  if (patch.title !== undefined) check('title', 'title')
  if (patch.steps !== undefined) check('steps', 'steps')
  if (patch.notes !== undefined) check('notes', 'notes')
  if (patch.intent !== undefined) check('intent', 'intent')
  if (patch.beanSnapshot !== undefined) check('beanSnapshot', 'bean_snapshot')
  if (patch.adjustmentFromPrevious !== undefined) check('adjustmentFromPrevious', 'adjustment_from_previous')
  if (patch.dripperPortability !== undefined) check('dripperPortability', 'dripper_portability')
  if (isRecord(patch.params)) {
    for (const key of Object.keys(patch.params)) {
      if (canonical(paramValue(before.params, key)) !== canonical(paramValue(after.params, key))) {
        changed.push(`params.${key}`)
      }
    }
  }
  return changed
}

/**
 * Update a recipe's editable fields and bump the version by 1, in one transaction.
 * The row is locked (`for update`), so the read, the expectedVersion check, the merge and the
 * write are one unit on both PostgreSQL and MySQL. NEVER writes owner_id / is_official / created_by.
 * dryRun returns { before, after, changed } and writes nothing (no version bump).
 * Throws NOT_FOUND for an unknown code, and VERSION_CONFLICT (with currentVersion) when
 * expectedVersion differs from the stored version.
 */
export async function updateRecipe(
  db: Kysely<DB>,
  code: string,
  patch: UpdateRecipePatch,
  options: UpdateRecipeOptions = {}
): Promise<UpdateRecipeResult> {
  return db.transaction().execute(async (trx): Promise<UpdateRecipeResult> => {
    const current = (await trx
      .selectFrom('recipes')
      .select(RECIPE_COLS)
      .where('code', '=', code)
      .forUpdate()
      .executeTakeFirst()) as unknown as RecipeRow | undefined
    if (!current) throw Object.assign(new Error(`recipe not found: ${code}`), { code: 'NOT_FOUND' })
    if (options.expectedVersion !== undefined && options.expectedVersion !== current.version) {
      throw Object.assign(
        new Error(`version conflict: ${code} is at version ${current.version}, expected ${options.expectedVersion}`),
        { code: 'VERSION_CONFLICT', currentVersion: current.version }
      )
    }

    const after = applyPatch(current, patch)
    if (isRecord(after.params) && Array.isArray(after.params.components) && typeof after.params.doseG === 'number') {
      const totalGrams = after.params.components.reduce((sum: number, component: unknown) =>
        isRecord(component) && typeof component.grams === 'number' ? sum + component.grams : sum, 0)
      if (Math.abs(totalGrams - after.params.doseG) - 0.05 > Number.EPSILON * Math.max(1, totalGrams, after.params.doseG)) {
        throw Object.assign(new Error(`params.components grams sum (${totalGrams} g) must match params.doseG (${after.params.doseG} g) within 0.05 g`), { code: 'INVALID_PARAMS' })
      }
    }
    if (options.dryRun) {
      return { kind: 'dryRun', before: current, after, changed: changedFields(current, after, patch) }
    }

    const set: Record<string, unknown> = {
      version: (current.version ?? 1) + 1,
    }
    if (patch.title !== undefined) set.title = patch.title
    if (patch.params !== undefined) set.params = asJsonb(after.params)
    if (patch.steps !== undefined) set.steps = asJsonb(patch.steps)
    if (patch.notes !== undefined) set.notes = patch.notes
    if (patch.intent !== undefined) set.intent = dbVendor() === 'mysql' ? JSON.stringify(patch.intent) : patch.intent
    if (patch.beanSnapshot !== undefined) set.bean_snapshot = asJsonb(patch.beanSnapshot)
    if (patch.adjustmentFromPrevious !== undefined) set.adjustment_from_previous = patch.adjustmentFromPrevious
    if (patch.dripperPortability !== undefined) set.dripper_portability = asJsonb(patch.dripperPortability)

    await (trx.updateTable('recipes') as any).set(set).where('code', '=', code).execute()
    const row = (await trx
      .selectFrom('recipes')
      .select(RECIPE_COLS)
      .where('code', '=', code)
      .executeTakeFirst()) as unknown as RecipeRow | undefined
    if (!row) throw Object.assign(new Error(`recipe not found: ${code}`), { code: 'NOT_FOUND' })
    return { kind: 'updated', row }
  })
}

const VALID_STATUSES = new Set(['active', 'archived', 'superseded', 'test', 'reference'])

/**
 * Set a recipe's status field. Allowed values: active | archived | superseded | test | reference.
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
  const row = await db.transaction().execute(async (trx) => {
    await (trx.updateTable('recipes') as any).set({ status }).where('code', '=', code).execute()
    return trx.selectFrom('recipes').select(RECIPE_COLS).where('code', '=', code).executeTakeFirst() as unknown as RecipeRow | undefined
  })
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
    await (trx.updateTable('recipes') as any)
      .set({ status: 'superseded', superseded_by: newCode })
      .where('code', '=', oldCode)
      .execute()
    const oldRow = await trx.selectFrom('recipes').select(RECIPE_COLS).where('code', '=', oldCode).executeTakeFirst() as unknown as RecipeRow | undefined
    if (!oldRow) throw Object.assign(new Error(`recipe not found: ${oldCode}`), { code: 'NOT_FOUND' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (trx.updateTable('recipes') as any)
      .set({ supersedes: oldCode })
      .where('code', '=', newCode)
      .execute()
    const newRow = await trx.selectFrom('recipes').select(RECIPE_COLS).where('code', '=', newCode).executeTakeFirst() as unknown as RecipeRow | undefined
    if (!newRow) throw Object.assign(new Error(`recipe not found: ${newCode}`), { code: 'NOT_FOUND' })

    return { old: oldRow, replacement: newRow }
  })
}

export async function insertManualRecipe(
  db: Kysely<DB>,
  payload: InsertManualRecipePayload
): Promise<RecipeRow> {
  const values: Record<string, unknown> = {
    id: crypto.randomUUID(),
    method: payload.method,
    title: payload.title,
    created_by: 'manual',
    version: 1,
    status: 'active',
  }
  // Leave bean_id null when client didn't supply one so the
  // recipes_link_bean BEFORE-INSERT trigger can link/dedup by bean_snapshot.
  if (payload.beanId != null) values.bean_id = payload.beanId
  if (payload.beanSnapshot !== undefined) values.bean_snapshot = asJsonb(payload.beanSnapshot)
  if (payload.params !== undefined) values.params = asJsonb(payload.params)
  if (payload.steps !== undefined) values.steps = asJsonb(payload.steps)
  if (payload.intent !== undefined) values.intent = dbVendor() === 'mysql' ? JSON.stringify(payload.intent) : payload.intent
  if (payload.notes !== undefined) values.notes = payload.notes
  if (payload.adjustmentFromPrevious !== undefined)
    values.adjustment_from_previous = payload.adjustmentFromPrevious
  if (payload.dripperPortability !== undefined)
    values.dripper_portability = asJsonb(payload.dripperPortability)

  // ROB-634: personal recipes are private to their anonymous owner.
  if (payload.ownerId) {
    return withOwnerWrites(db, async (trx) => {
      const id = values.id as string
      await trx
        .insertInto('recipes')
        .values(
          { ...values, owner_id: payload.ownerId } as Parameters<
            ReturnType<typeof trx.insertInto<'recipes'>>['values']
          >[0]
        )
        .execute()
      return await trx.selectFrom('recipes').select(RECIPE_COLS).where('id', '=', id).executeTakeFirstOrThrow() as unknown as RecipeRow
    })
  }

  const id = values.id as string
  return db.transaction().execute(async (trx) => {
    await trx
    .insertInto('recipes')
    .values(values as Parameters<ReturnType<typeof db.insertInto<'recipes'>>['values']>[0])
    .execute()
    return await trx.selectFrom('recipes').select(RECIPE_COLS).where('id', '=', id).executeTakeFirstOrThrow() as unknown as RecipeRow
  })
}
