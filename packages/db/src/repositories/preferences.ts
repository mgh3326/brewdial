import { type Kysely } from 'kysely'
import type { DB } from '../types.js'
import { dbVendor } from '../db.js'

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

/**
 * setGlobalPreference — upsert likes/dislikes on the singleton 'global' row.
 * S1: global write (per-user is S4).
 */
export async function setGlobalPreference(
  db: Kysely<DB>,
  input: { likes: string[]; dislikes: string[] }
): Promise<PreferenceRow> {
  const mysql = dbVendor() === 'mysql'
  const values = { id: 'global', likes: mysql ? JSON.stringify(input.likes) : input.likes, dislikes: mysql ? JSON.stringify(input.dislikes) : input.dislikes }
  return db.transaction().execute(async (trx) => {
    const query = (trx.insertInto('preferences') as any).values(values)
    if (mysql) {
      await query.onDuplicateKeyUpdate({ likes: JSON.stringify(input.likes), dislikes: JSON.stringify(input.dislikes), updated_at: new Date() }).execute()
    } else {
      await query.onConflict((oc: any) => oc.column('id').doUpdateSet({ likes: input.likes, dislikes: input.dislikes, updated_at: new Date() })).execute()
    }
    const row = await trx.selectFrom('preferences').select(PREFERENCE_COLS).where('id', '=', 'global').executeTakeFirstOrThrow()
    return { ...row, likes: typeof row.likes === 'string' ? JSON.parse(row.likes) : row.likes, dislikes: typeof row.dislikes === 'string' ? JSON.parse(row.dislikes) : row.dislikes } as PreferenceRow
  })
}
