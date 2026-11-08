import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'
import { dbVendor } from '../db.js'

export interface GearInput {
  kind: 'grinder' | 'dripper'
  label: string
  grinderId?: string | null
  dripperId?: string | null
  details?: Record<string, unknown>
  isDefault?: boolean
}

export interface CalibrationInput {
  fromLabel: string
  toLabel: string
  anchorMethod?: string | null
  fromGrinderId?: string | null
  toGrinderId?: string | null
  samples?: unknown[]
  source?: 'measured' | 'dial-in-start'
  notes?: string | null
}

// upsertGear: in a transaction, if isDefault then clear prior default of same kind,
// then insert the gear row. Returns the gear id.
// Matches rpc_upsert_gear semantics.
export async function upsertGear(db: Kysely<DB>, appUserId: string, gear: GearInput): Promise<string> {
  const id = crypto.randomUUID()
  return db.transaction().execute(async (trx) => {
    if (gear.isDefault) {
      await trx
        .updateTable('user_gear')
        .set({ is_default: false })
        .where('app_user_id', '=', appUserId)
        .where('kind', '=', gear.kind)
        .where('is_default', '=', true)
        .execute()
    }

    await trx
      .insertInto('user_gear')
      .values({
        id,
        app_user_id: appUserId,
        kind: gear.kind,
        grinder_id: gear.grinderId ?? null,
        dripper_id: gear.dripperId ?? null,
        label: gear.label,
        details: (dbVendor() === 'mysql' ? JSON.stringify(gear.details ?? {}) : gear.details ?? {}) as unknown as import('../types.js').Json,
        is_default: gear.isDefault ?? false,
      })
      .execute()

    return id
  })
}

// upsertCalibration: upsert on the coalesce-stable pair unique index.
// Conflict target matches grinder_calibration_pair_uidx.
// Matches rpc_upsert_calibration semantics.
export async function upsertCalibration(db: Kysely<DB>, appUserId: string, cal: CalibrationInput): Promise<string> {
  const id = crypto.randomUUID()
  if (dbVendor() === 'mysql') {
    return db.transaction().execute(async (trx) => {
    await sql`insert into grinder_calibration
      (id, app_user_id, from_grinder_id, to_grinder_id, from_label, to_label, anchor_method, samples, source, notes)
      values (${id}, ${appUserId}, ${cal.fromGrinderId ?? null}, ${cal.toGrinderId ?? null}, ${cal.fromLabel}, ${cal.toLabel},
        ${cal.anchorMethod ?? null}, ${JSON.stringify(cal.samples ?? [])}, ${cal.source ?? 'measured'}, ${cal.notes ?? null})
      on duplicate key update samples = values(samples), source = values(source), notes = values(notes)`.execute(trx)
    const row = await sql<{ id: string }>`select id from grinder_calibration where app_user_id = ${appUserId}
      and coalesce(from_grinder_id, lower(from_label)) = coalesce(${cal.fromGrinderId ?? null}, lower(${cal.fromLabel}))
      and coalesce(to_grinder_id, lower(to_label)) = coalesce(${cal.toGrinderId ?? null}, lower(${cal.toLabel}))
      and coalesce(anchor_method, '') = coalesce(${cal.anchorMethod ?? null}, '')`.execute(trx)
    return row.rows[0].id
    })
  }
  const result = await sql<{ id: string }>`
    insert into grinder_calibration
      (id, app_user_id, from_grinder_id, to_grinder_id, from_label, to_label, anchor_method, samples, source, notes)
    values (
      ${id}::uuid,
      ${appUserId}::uuid,
      ${cal.fromGrinderId ?? null}::uuid,
      ${cal.toGrinderId ?? null}::uuid,
      ${cal.fromLabel},
      ${cal.toLabel},
      ${cal.anchorMethod ?? null},
      ${JSON.stringify(cal.samples ?? [])}::jsonb,
      ${cal.source ?? 'measured'},
      ${cal.notes ?? null}
    )
    on conflict (
      app_user_id,
      coalesce(from_grinder_id::text, lower(from_label)),
      coalesce(to_grinder_id::text,   lower(to_label)),
      coalesce(anchor_method, '')
    )
    do update set
      samples = excluded.samples,
      source  = excluded.source,
      notes   = excluded.notes
    returning id`.execute(db)

  return result.rows[0].id
}
