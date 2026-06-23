import { type Kysely } from 'kysely'
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
]

export function listBeans(db: Kysely<DB>): Promise<BeanRow[]> {
  return db
    .selectFrom('bean_summaries')
    .select(BEAN_COLS)
    .where('recipe_count', '>', '0')
    .orderBy('latest_recipe_at', 'desc')
    .execute() as unknown as Promise<BeanRow[]>
}

export function getBean(db: Kysely<DB>, id: string): Promise<BeanRow | undefined> {
  return db
    .selectFrom('bean_summaries')
    .select(BEAN_COLS)
    .where('id', '=', id)
    .executeTakeFirst() as unknown as Promise<BeanRow | undefined>
}
