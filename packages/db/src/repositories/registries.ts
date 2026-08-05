import type { Kysely } from 'kysely'
import type { DB } from '../types.js'

export function listGrinders(db: Kysely<DB>) {
  return db.selectFrom('grinders').selectAll().orderBy('name').execute()
}

export function listDrippers(db: Kysely<DB>) {
  return db.selectFrom('drippers').selectAll().orderBy('continuum_position').execute()
}
