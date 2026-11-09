import { type Kysely } from 'kysely'
import type { DB } from '../types.js'
import { dbVendor } from '../db.js'

// Row shape matching the client mapper's FeedbackRow
// (apps/miniapp/src/lib/data/mappers.ts — FeedbackRow interface).
// Explicit type bounds Kysely inference and prevents TS2589.
export interface FeedbackRow {
  id: string
  recipe_code: string
  bean_id: string | null
  owner_id: string | null
  ratings: unknown | null
  actual: unknown | null
  comment: string | null
  raw_comment: string | null
  quick_tags: string[] | null
  desired_direction: string[] | null
  next_hint: string[] | null
  source: string
  created_at: Date
  updated_at: Date
  recipe_version: number | null
  recipe_snapshot: unknown | null
  recipe_current_version?: number
}

// Exact columns the client mapper (FEEDBACK_COLUMNS in apps/miniapp/src/lib/data/mappers.ts) expects.
// Typed as ReadonlyArray<keyof DB['feedback']> (not `as const`) to prevent TS2589 depth explosion.
const FEEDBACK_COLS: ReadonlyArray<keyof DB['feedback']> = [
  'id',
  'recipe_code',
  'bean_id',
  'owner_id',
  'ratings',
  'actual',
  'comment',
  'raw_comment',
  'quick_tags',
  'desired_direction',
  'next_hint',
  'source',
  'created_at',
  'updated_at',
  'recipe_version',
  'recipe_snapshot',
]

export async function listFeedbackByRecipe(db: Kysely<DB>, code: string): Promise<FeedbackRow[]> {
  const rows = await db
    .selectFrom('feedback')
    .innerJoin('recipes', 'recipes.code', 'feedback.recipe_code')
    .select([...FEEDBACK_COLS.map((col) => `feedback.${col}` as any), 'recipes.version as recipe_current_version'] as any)
    .where('feedback.recipe_code', '=', code)
    .orderBy('feedback.created_at', 'desc')
    .execute() as unknown as FeedbackRow[]
  const normalize = (v: unknown) => typeof v === 'string' ? JSON.parse(v) : v
  return rows.map((row) => ({ ...row, ratings: normalize(row.ratings), actual: normalize(row.actual), quick_tags: normalize(row.quick_tags), desired_direction: normalize(row.desired_direction), next_hint: normalize(row.next_hint), recipe_snapshot: normalize(row.recipe_snapshot) }))
}

export interface InsertFeedbackPayload {
  recipeCode: string
  beanId?: string | null
  ownerId?: string | null
  ratings?: unknown
  actual?: unknown
  comment?: string
  rawComment?: string
  quickTags?: string[]
  desiredDirection?: string[]
  nextHint?: string[]
  source?: string
}

// Typed error for recipe-not-found, lets routes return 404 instead of a raw FK 500.
export class RecipeNotFoundError extends Error {
  code = 'RECIPE_NOT_FOUND' as const
  constructor(recipeCode: string) {
    super(`Recipe not found: ${recipeCode}`)
    this.name = 'RecipeNotFoundError'
  }
}

// Source values allowed from the agent/MCP API surface.
const AGENT_ALLOWED_SOURCES = new Set(['agent', 'mcp', 'coffee_profile', 'api'])

export interface InsertAgentFeedbackPayload extends InsertFeedbackPayload {
  source?: string
}

/**
 * insertAgentFeedback — like insertFeedback but:
 *   - source defaults to 'agent'; rejects sources outside AGENT_ALLOWED_SOURCES.
 *   - Verifies recipe exists before insert (→ RecipeNotFoundError on miss).
 */
export async function insertAgentFeedback(
  db: Kysely<DB>,
  payload: InsertAgentFeedbackPayload
): Promise<FeedbackRow> {
  const source = payload.source ?? 'agent'
  if (!AGENT_ALLOWED_SOURCES.has(source)) {
    const err = new Error(`invalid source: ${source}`) as Error & { code: string }
    err.code = 'INVALID_SOURCE'
    throw err
  }

  // Verify recipe exists — avoids FK violation 500.
  const recipeCheck = await db
    .selectFrom('recipes')
    .select('code')
    .where('code', '=', payload.recipeCode)
    .executeTakeFirst()
  if (!recipeCheck) {
    throw new RecipeNotFoundError(payload.recipeCode)
  }

  return insertFeedback(db, { ...payload, source })
}

export function insertFeedback(
  db: Kysely<DB>,
  payload: InsertFeedbackPayload
): Promise<FeedbackRow> {
  const values: Record<string, unknown> = {
    id: crypto.randomUUID(),
    recipe_code: payload.recipeCode,
    source: payload.source ?? 'web',
  }
  if (payload.beanId != null) values.bean_id = payload.beanId
  if (payload.ownerId != null) values.owner_id = payload.ownerId
  if (payload.ratings !== undefined) values.ratings = dbVendor() === 'mysql' ? JSON.stringify(payload.ratings) : payload.ratings as unknown
  if (payload.actual !== undefined) values.actual = dbVendor() === 'mysql' ? JSON.stringify(payload.actual) : payload.actual as unknown
  if (payload.comment !== undefined) values.comment = payload.comment
  if (payload.rawComment !== undefined) values.raw_comment = payload.rawComment
  if (payload.quickTags !== undefined) values.quick_tags = dbVendor() === 'mysql' ? JSON.stringify(payload.quickTags) : payload.quickTags
  if (payload.desiredDirection !== undefined) values.desired_direction = dbVendor() === 'mysql' ? JSON.stringify(payload.desiredDirection) : payload.desiredDirection
  if (payload.nextHint !== undefined) values.next_hint = dbVendor() === 'mysql' ? JSON.stringify(payload.nextHint) : payload.nextHint

  const id = values.id as string
  return db.transaction().execute(async (trx) => {
    const recipe = await trx.selectFrom('recipes').select(['version', 'params', 'steps', 'method', 'bean_id', 'dripper_portability']).where('code', '=', payload.recipeCode).forUpdate().executeTakeFirst()
    if (!recipe) throw new RecipeNotFoundError(payload.recipeCode)
    const params = typeof recipe.params === 'string' ? JSON.parse(recipe.params) : recipe.params as Record<string, unknown> | null
    const grind = params?.grind as { perGrinder?: Array<{ grinderId?: string }> } | undefined
    const portability = typeof recipe.dripper_portability === 'string' ? JSON.parse(recipe.dripper_portability) : recipe.dripper_portability as { origin?: { dripperId?: string } } | null
    const snapshot = {
      params: params ?? {},
      steps: typeof recipe.steps === 'string' ? JSON.parse(recipe.steps) : recipe.steps ?? [],
      method: recipe.method,
      ...(typeof portability?.origin?.dripperId === 'string' ? { dripperId: portability.origin.dripperId } : {}),
      ...(grind?.perGrinder?.some((part) => typeof part.grinderId === 'string') ? { grinderIds: grind.perGrinder.flatMap((part) => typeof part.grinderId === 'string' ? [part.grinderId] : []), grinderId: grind.perGrinder.find((part) => typeof part.grinderId === 'string')!.grinderId } : {}),
      ...(recipe.bean_id ? { beanId: recipe.bean_id } : {}),
    }
    values.recipe_version = recipe.version
    values.recipe_snapshot = dbVendor() === 'mysql' ? JSON.stringify(snapshot) : JSON.stringify(snapshot)
    await trx
    .insertInto('feedback')
    .values(values as Parameters<ReturnType<typeof db.insertInto<'feedback'>>['values']>[0])
    .execute()
    const row = await trx.selectFrom('feedback').select(FEEDBACK_COLS).where('id', '=', id).executeTakeFirstOrThrow()
    const normalize = (v: unknown) => typeof v === 'string' ? JSON.parse(v) : v
    return {
      ...row,
      ratings: normalize(row.ratings), actual: normalize(row.actual),
      quick_tags: normalize(row.quick_tags) as string[] | null,
      desired_direction: normalize(row.desired_direction) as string[] | null,
      next_hint: normalize(row.next_hint) as string[] | null,
    } as unknown as FeedbackRow
  })
}

export interface UpdateFeedbackPatch {
  ratings?: Record<string, number | null>
  actual?: Record<string, unknown>
  rawComment?: string | null
  comment?: string | null
  quickTags?: string[] | null
  desiredDirection?: string[] | null
  nextHint?: string[] | null
}

export async function updateFeedback(db: Kysely<DB>, id: string, patch: UpdateFeedbackPatch, options: { expectedUpdatedAt?: string; dryRun?: boolean } = {}) {
  return db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('feedback').select(FEEDBACK_COLS).where('id', '=', id).forUpdate().executeTakeFirst() as unknown as FeedbackRow | undefined
    if (!current) throw Object.assign(new Error('feedback not found'), { code: 'NOT_FOUND' })
    const millis = (v: unknown) => new Date(v as string | Date).getTime()
    const iso = (v: unknown) => v instanceof Date ? v.toISOString() : String(v)
    const currentUpdatedAt = iso(current.updated_at)
    if (options.expectedUpdatedAt && millis(options.expectedUpdatedAt) !== millis(current.updated_at)) throw Object.assign(new Error('feedback version conflict'), { code: 'VERSION_CONFLICT', currentUpdatedAt })
    const parse = (v: unknown): Record<string, unknown> => typeof v === 'string' ? JSON.parse(v) : (v && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : {})
    const before = { ...current, ratings: current.ratings == null ? null : parse(current.ratings), actual: current.actual == null ? null : parse(current.actual) }
    const after: Record<string, unknown> = { ...before }
    for (const key of ['ratings', 'actual'] as const) if (patch[key] !== undefined) {
      const merged = parse(before[key]);
      for (const [field, value] of Object.entries(patch[key]!)) value === null ? delete merged[field] : merged[field] = value
      after[key] = Object.keys(merged).length ? merged : null
    }
    const cols: Record<string, string> = { rawComment: 'raw_comment', comment: 'comment', quickTags: 'quick_tags', desiredDirection: 'desired_direction', nextHint: 'next_hint' }
    for (const [key, col] of Object.entries(cols)) if ((patch as any)[key] !== undefined) after[col] = (patch as any)[key]
    const changed = [...new Set([...Object.keys(patch).filter((k) => ['ratings', 'actual'].includes(k)), ...Object.keys(cols).filter((k) => (patch as any)[k] !== undefined)])]
    if (options.dryRun) return { kind: 'dryRun' as const, before, after, changed }
    const set: Record<string, unknown> = {}
    for (const key of ['ratings', 'actual'] as const) if (patch[key] !== undefined) set[key] = dbVendor() === 'mysql' ? (after[key] == null ? null : JSON.stringify(after[key])) : (after[key] == null ? null : JSON.stringify(after[key]))
    for (const [key, col] of Object.entries(cols)) if ((patch as any)[key] !== undefined) {
      const value = (patch as any)[key]
      set[col] = value == null ? null : (['quickTags', 'desiredDirection', 'nextHint'].includes(key) && dbVendor() === 'mysql' ? JSON.stringify(value) : value)
    }
    if (Object.keys(set).length) await (trx.updateTable('feedback') as any).set(set).where('id', '=', id).execute()
    const row = await trx.selectFrom('feedback').select(FEEDBACK_COLS).where('id', '=', id).executeTakeFirstOrThrow()
    const normalize = (v: unknown) => typeof v === 'string' ? JSON.parse(v) : v
    return { kind: 'updated' as const, row: { ...row, ratings: normalize(row.ratings), actual: normalize(row.actual), quick_tags: normalize(row.quick_tags), desired_direction: normalize(row.desired_direction), next_hint: normalize(row.next_hint), recipe_snapshot: normalize(row.recipe_snapshot) } as unknown as FeedbackRow }
  })
}
