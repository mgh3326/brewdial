import { type Kysely } from 'kysely'
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
