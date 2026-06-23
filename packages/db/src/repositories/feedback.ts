import { type Kysely } from 'kysely'
import type { DB } from '../types.js'

// Exact columns the client mapper (FEEDBACK_COLUMNS in apps/miniapp/src/lib/data/mappers.ts) expects.
const FEEDBACK_COLS = [
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
] as const

export function listFeedbackByRecipe(db: Kysely<DB>, code: string) {
  return db
    .selectFrom('feedback')
    .select(FEEDBACK_COLS)
    .where('recipe_code', '=', code)
    .orderBy('created_at', 'desc')
    .execute()
}
