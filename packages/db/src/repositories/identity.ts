import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'
import { dbVendor } from '../db.js'

export async function resolveAppUser(db: Kysely<DB>, provider: string, externalKey: string): Promise<string> {
  if (dbVendor() !== 'mysql') {
    const r = await sql<{ resolve_app_user: string }>`select resolve_app_user(${provider}, ${externalKey}) as resolve_app_user`.execute(db)
    return r.rows[0].resolve_app_user
  }
  if (!['toss_anon', 'web_local'].includes(provider)) throw new Error('resolve_app_user: v1 RPC accepts only toss_anon|web_local')
  if (!externalKey.trim() || externalKey.length < 16) throw new Error('resolve_app_user: external_key too short')
  const existing = await db.selectFrom('user_identities').select('app_user_id')
    .where('provider', '=', provider).where('external_key', '=', externalKey).executeTakeFirst()
  if (existing) return existing.app_user_id
  try {
    return await db.transaction().execute(async (trx) => {
      const userId = crypto.randomUUID()
      await trx.insertInto('app_users').values({ id: userId }).execute()
      await trx.insertInto('user_identities').values({ id: crypto.randomUUID(), app_user_id: userId, provider, external_key: externalKey }).execute()
      return userId
    })
  } catch (error) {
    const duplicate = (error as { code?: string; errno?: number })?.code === 'ER_DUP_ENTRY'
      || (error as { errno?: number })?.errno === 1062
    if (!duplicate) throw error
    const winner = await db.selectFrom('user_identities').select('app_user_id')
      .where('provider', '=', provider).where('external_key', '=', externalKey).executeTakeFirst()
    if (winner) return winner.app_user_id
    throw error
  }
}
