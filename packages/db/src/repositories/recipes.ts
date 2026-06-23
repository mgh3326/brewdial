import { type Kysely } from 'kysely'
import type { DB } from '../types.js'

// Exact columns the client mapper (RECIPE_COLUMNS in apps/miniapp/src/lib/data/mappers.ts) expects.
const RECIPE_COLS = [
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
] as const

export function listRecentRecipes(db: Kysely<DB>, limit = 20) {
  const n = Math.min(100, Math.max(1, limit))
  return db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .limit(n)
    .execute()
}

export function getRecipeByCode(db: Kysely<DB>, code: string) {
  return db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .where('code', '=', code)
    .where('status', '<>', 'test')
    .executeTakeFirst()
}

export function listRecipesByBean(db: Kysely<DB>, beanId: string) {
  return db
    .selectFrom('recipes')
    .select(RECIPE_COLS)
    .where('bean_id', '=', beanId)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .execute()
}
