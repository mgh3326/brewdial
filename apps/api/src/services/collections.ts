// Re-export the collections service from @brewdial/db for use in route handlers.
// The actual logic lives in packages/db/src/repositories/collections.ts so it
// has direct access to the generated DB type.
export { getMyCollections } from '@brewdial/db'
export type {
  MyCollections,
  SavedRecipeRow,
  SavedBeanRow,
  UserGearRow,
  GrinderCalibrationRow,
} from '@brewdial/db'
