import { type Kysely } from 'kysely'
import type { DB } from '../types.js'

// Row shapes for each collection entity.
// Explicit interfaces prevent TS2589 depth explosion and match rpc_my_collections output.

export interface SavedRecipeRow {
  id: string
  app_user_id: string
  recipe_code: string
  snapshot: unknown | null
  note: string | null
  created_at: Date
}

export interface SavedBeanRow {
  id: string
  app_user_id: string
  bean_id: string
  note: string | null
  created_at: Date
}

export interface UserGearRow {
  id: string
  app_user_id: string
  kind: string
  grinder_id: string | null
  dripper_id: string | null
  label: string
  details: unknown
  is_default: boolean
  created_at: Date
  updated_at: Date
}

export interface GrinderCalibrationRow {
  id: string
  app_user_id: string
  from_grinder_id: string | null
  to_grinder_id: string | null
  from_label: string
  to_label: string
  anchor_method: string | null
  samples: unknown
  source: string
  notes: string | null
  created_at: Date
  updated_at: Date
}

// Composite shape that matches rpc_my_collections output and user-content.ts MyCollections.
export interface MyCollections {
  savedRecipes: SavedRecipeRow[]
  savedBeans: SavedBeanRow[]
  gear: UserGearRow[]
  calibration: GrinderCalibrationRow[]
  myRecipes: string[]
}

const SAVED_RECIPE_COLS: ReadonlyArray<keyof DB['saved_recipes']> = [
  'id', 'app_user_id', 'recipe_code', 'snapshot', 'note', 'created_at',
]

const SAVED_BEAN_COLS: ReadonlyArray<keyof DB['saved_beans']> = [
  'id', 'app_user_id', 'bean_id', 'note', 'created_at',
]

const USER_GEAR_COLS: ReadonlyArray<keyof DB['user_gear']> = [
  'id', 'app_user_id', 'kind', 'grinder_id', 'dripper_id',
  'label', 'details', 'is_default', 'created_at', 'updated_at',
]

const CALIBRATION_COLS: ReadonlyArray<keyof DB['grinder_calibration']> = [
  'id', 'app_user_id', 'from_grinder_id', 'to_grinder_id',
  'from_label', 'to_label', 'anchor_method', 'samples', 'source',
  'notes', 'created_at', 'updated_at',
]

// Assembles the composite MyCollections for an appUserId.
// Field names and inner item shapes match what rpc_my_collections returned
// and user-content.ts consumes.
export async function getMyCollections(db: Kysely<DB>, appUserId: string): Promise<MyCollections> {
  const [savedRecipes, savedBeans, gear, calibration, ownedRows] = await Promise.all([
    db
      .selectFrom('saved_recipes')
      .select(SAVED_RECIPE_COLS)
      .where('app_user_id', '=', appUserId)
      .orderBy('created_at', 'desc')
      .execute() as unknown as Promise<SavedRecipeRow[]>,

    db
      .selectFrom('saved_beans')
      .select(SAVED_BEAN_COLS)
      .where('app_user_id', '=', appUserId)
      .orderBy('created_at', 'desc')
      .execute() as unknown as Promise<SavedBeanRow[]>,

    db
      .selectFrom('user_gear')
      .select(USER_GEAR_COLS)
      .where('app_user_id', '=', appUserId)
      .execute() as unknown as Promise<UserGearRow[]>,

    db
      .selectFrom('grinder_calibration')
      .select(CALIBRATION_COLS)
      .where('app_user_id', '=', appUserId)
      .execute() as unknown as Promise<GrinderCalibrationRow[]>,

    db
      .selectFrom('recipes')
      .select('code')
      .where('owner_id', '=', appUserId)
      .where('status', '=', 'active')
      .execute(),
  ])

  return {
    savedRecipes,
    savedBeans,
    gear,
    calibration,
    myRecipes: ownedRows.map((r) => r.code as string),
  }
}
