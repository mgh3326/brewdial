import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'

// Snapshot captured server-side via to_jsonb of the recipe row (excludes test-status).
// Upserts on (app_user_id, recipe_code) — matches rpc_save_recipe semantics.
export async function saveRecipe(db: Kysely<DB>, appUserId: string, code: string): Promise<void> {
  await sql`
    insert into saved_recipes (app_user_id, recipe_code, snapshot)
    select ${appUserId}::uuid, r.code, to_jsonb(r)
      from recipes r where r.code = ${code} and r.status <> 'test'
    on conflict (app_user_id, recipe_code) do update set snapshot = excluded.snapshot`.execute(db)
}

// insert on conflict do nothing — matches rpc_save_bean semantics.
export async function saveBean(db: Kysely<DB>, appUserId: string, beanId: string): Promise<void> {
  await sql`insert into saved_beans (app_user_id, bean_id) values (${appUserId}::uuid, ${beanId})
            on conflict (app_user_id, bean_id) do nothing`.execute(db)
}
