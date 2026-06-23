import { type Kysely } from 'kysely'
import type { DB } from '../types.js'

// Row shape for the preferences table — matches the MCP preferences shape.
export interface PreferenceRow {
  id: string
  likes: string[]
  dislikes: string[]
  default_params: Record<string, unknown>
  created_at: Date
  updated_at: Date
}

const PREFERENCE_COLS = [
  'id',
  'likes',
  'dislikes',
  'default_params',
  'created_at',
  'updated_at',
] as const satisfies ReadonlyArray<keyof DB['preferences']>

/**
 * getGlobalPreference — fetch the singleton 'global' preferences row.
 * Returns undefined if not found (route may return null / 200).
 */
export function getGlobalPreference(db: Kysely<DB>): Promise<PreferenceRow | undefined> {
  return db
    .selectFrom('preferences')
    .select(PREFERENCE_COLS)
    .where('id', '=', 'global')
    .executeTakeFirst() as unknown as Promise<PreferenceRow | undefined>
}
