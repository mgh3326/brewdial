import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'
import { dbVendor } from '../db.js'

// Snapshot captured server-side via to_jsonb of the recipe row (excludes test/reference status).
// Upserts on (app_user_id, recipe_code) — matches rpc_save_recipe semantics.
export async function saveRecipe(db: Kysely<DB>, appUserId: string, code: string): Promise<void> {
  if (dbVendor() === 'mysql') {
    await db.transaction().execute(async (trx) => {
      const result = await sql<{ code: string; snapshot: unknown }>`
        select r.code, json_object(
          'id', r.id, 'code', r.code, 'method', r.method, 'title', r.title, 'version', r.version,
          'params', r.params, 'steps', r.steps, 'bean_id', r.bean_id, 'bean_snapshot', r.bean_snapshot,
          'intent', r.intent, 'notes', r.notes, 'adjustment_from_previous', r.adjustment_from_previous,
          'created_by', r.created_by, 'owner_id', r.owner_id,
          'is_official', json_extract(if(r.is_official, 'true', 'false'), '$'),
          'dripper_portability', r.dripper_portability, 'status', r.status,
          'supersedes', r.supersedes, 'superseded_by', r.superseded_by, 'parent_code', r.parent_code,
          'created_at', concat(date_format(r.created_at, '%Y-%m-%dT%H:%i:%s'),
            if(microsecond(r.created_at) = 0, '', concat('.', trim(trailing '0' from date_format(r.created_at, '%f')))), '+00:00'),
          'updated_at', concat(date_format(r.updated_at, '%Y-%m-%dT%H:%i:%s'),
            if(microsecond(r.updated_at) = 0, '', concat('.', trim(trailing '0' from date_format(r.updated_at, '%f')))), '+00:00')
        ) as snapshot
        from recipes r where r.code = ${code} and r.status not in ('test', 'reference')`.execute(trx)
      const recipe = result.rows[0]
      if (!recipe) return
      const snapshot = typeof recipe.snapshot === 'string' ? recipe.snapshot : JSON.stringify(recipe.snapshot)
      const query = (trx.insertInto('saved_recipes') as any).values({
        id: crypto.randomUUID(), app_user_id: appUserId, recipe_code: recipe.code, snapshot,
      })
      await query.onDuplicateKeyUpdate({ snapshot }).execute()
    })
    return
  }
  await sql`
    insert into saved_recipes (id, app_user_id, recipe_code, snapshot)
    select ${crypto.randomUUID()}::uuid, ${appUserId}::uuid, r.code, to_jsonb(r)
      from recipes r where r.code = ${code} and r.status not in ('test', 'reference')
    on conflict (app_user_id, recipe_code) do update set snapshot = excluded.snapshot`.execute(db)
}

// insert on conflict do nothing — matches rpc_save_bean semantics.
export async function saveBean(db: Kysely<DB>, appUserId: string, beanId: string): Promise<void> {
  if (dbVendor() === 'mysql') {
    await (db.insertInto('saved_beans') as any).values({ id: crypto.randomUUID(), app_user_id: appUserId, bean_id: beanId })
      .onDuplicateKeyUpdate({ bean_id: beanId }).execute()
    return
  }
  await sql`insert into saved_beans (id, app_user_id, bean_id) values (${crypto.randomUUID()}::uuid, ${appUserId}::uuid, ${beanId})
            on conflict (app_user_id, bean_id) do nothing`.execute(db)
}
