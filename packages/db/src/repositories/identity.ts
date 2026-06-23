import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'

export async function resolveAppUser(db: Kysely<DB>, provider: string, externalKey: string): Promise<string> {
  const r = await sql<{ resolve_app_user: string }>`select resolve_app_user(${provider}, ${externalKey}) as resolve_app_user`.execute(db)
  return r.rows[0].resolve_app_user
}
