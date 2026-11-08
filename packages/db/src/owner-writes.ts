import { sql, type Kysely } from 'kysely'
import type { DB } from './types.js'
import { dbVendor } from './db.js'

/** Run a transaction with the recipe owner-write trigger enabled only for that transaction. */
export function withOwnerWrites<T>(db: Kysely<DB>, block: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    if (dbVendor() === 'mysql') {
      await sql`set @bd_owner_write_ok = 'on'`.execute(trx)
      try {
        return await block(trx)
      } finally {
        await sql`set @bd_owner_write_ok = null`.execute(trx)
      }
    }
    await sql`select set_config('bd.owner_write_ok','on',true)`.execute(trx)
    return block(trx)
  })
}
