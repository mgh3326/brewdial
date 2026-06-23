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
