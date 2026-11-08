import type { Kysely } from 'kysely'
import type { DB } from '../types.js'
import { dbVendor } from '../db.js'

function canonicalDecimal(value: unknown): unknown {
  if (dbVendor() !== 'mysql' || typeof value !== 'string' || !/^-?\d+\.\d+$/.test(value)) return value
  return value.replace(/0+$/, '').replace(/\.$/, '')
}

export function listGrinders(db: Kysely<DB>) {
  return db.selectFrom('grinders').selectAll().orderBy('name').execute().then((rows) =>
    rows.map((row) => ({ ...row, um_per_click_est: canonicalDecimal(row.um_per_click_est) as typeof row.um_per_click_est })),
  )
}

export function listDrippers(db: Kysely<DB>) {
  return db.selectFrom('drippers').selectAll().orderBy('continuum_position').execute().then((rows) =>
    rows.map((row) => ({ ...row, continuum_position: canonicalDecimal(row.continuum_position) as typeof row.continuum_position })),
  )
}
