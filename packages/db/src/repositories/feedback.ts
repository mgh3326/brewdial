import { type Kysely } from 'kysely'
import type { DB } from '../types.js'

// Row shape matching the client mapper's FeedbackRow
// (apps/miniapp/src/lib/data/mappers.ts — FeedbackRow interface).
// Explicit type bounds Kysely inference and prevents TS2589.
export interface FeedbackRow {
  id: string
  recipe_code: string
  bean_id: string | null
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
}

// Exact columns the client mapper (FEEDBACK_COLUMNS in apps/miniapp/src/lib/data/mappers.ts) expects.
// Typed as ReadonlyArray<keyof DB['feedback']> (not `as const`) to prevent TS2589 depth explosion.
const FEEDBACK_COLS: ReadonlyArray<keyof DB['feedback']> = [
  'id',
  'recipe_code',
  'bean_id',
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
]

export function listFeedbackByRecipe(db: Kysely<DB>, code: string): Promise<FeedbackRow[]> {
  return db
    .selectFrom('feedback')
    .select(FEEDBACK_COLS)
    .where('recipe_code', '=', code)
    .orderBy('created_at', 'desc')
    .execute() as unknown as Promise<FeedbackRow[]>
}

export interface InsertFeedbackPayload {
  recipeCode: string
  beanId?: string | null
  ratings?: unknown
  actual?: unknown
  comment?: string
  rawComment?: string
  quickTags?: string[]
  desiredDirection?: string[]
  nextHint?: string[]
  source?: string
}

export function insertFeedback(
  db: Kysely<DB>,
  payload: InsertFeedbackPayload
): Promise<FeedbackRow> {
  const values: Record<string, unknown> = {
    recipe_code: payload.recipeCode,
    source: payload.source ?? 'web',
  }
  if (payload.beanId != null) values.bean_id = payload.beanId
  if (payload.ratings !== undefined) values.ratings = payload.ratings as unknown
  if (payload.actual !== undefined) values.actual = payload.actual as unknown
  if (payload.comment !== undefined) values.comment = payload.comment
  if (payload.rawComment !== undefined) values.raw_comment = payload.rawComment
  if (payload.quickTags !== undefined) values.quick_tags = payload.quickTags
  if (payload.desiredDirection !== undefined) values.desired_direction = payload.desiredDirection
  if (payload.nextHint !== undefined) values.next_hint = payload.nextHint

  return db
    .insertInto('feedback')
    .values(values as Parameters<ReturnType<typeof db.insertInto<'feedback'>>['values']>[0])
    .returning(FEEDBACK_COLS)
    .executeTakeFirstOrThrow() as unknown as Promise<FeedbackRow>
}
