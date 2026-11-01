import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'

export async function resolveAppUser(db: Kysely<DB>, provider: string, externalKey: string): Promise<string> {
  const r = await sql<{ resolve_app_user: string }>`select resolve_app_user(${provider}, ${externalKey}) as resolve_app_user`.execute(db)
  return r.rows[0].resolve_app_user
}

export async function findAppUser(db: Kysely<DB>, provider: string, externalKey: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('user_identities')
    .select('app_user_id')
    .where('provider', '=', provider)
    .where('external_key', '=', externalKey)
    .executeTakeFirst()
  return row?.app_user_id
}
