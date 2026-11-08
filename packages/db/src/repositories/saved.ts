import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'
import { dbVendor } from '../db.js'

// Snapshot captured server-side via to_jsonb of the recipe row (excludes test/reference status).
// Upserts on (app_user_id, recipe_code) — matches rpc_save_recipe semantics.
export async function saveRecipe(db: Kysely<DB>, appUserId: string, code: string): Promise<void> {
  if (dbVendor() === 'mysql') {
    const recipe = await db.selectFrom('recipes').selectAll().where('code', '=', code)
      .where('status', 'not in', ['test', 'reference']).executeTakeFirst()
    if (!recipe) return
    const query = (db.insertInto('saved_recipes') as any).values({
      id: crypto.randomUUID(), app_user_id: appUserId, recipe_code: recipe.code,
      snapshot: JSON.stringify(recipe),
    })
    await query.onDuplicateKeyUpdate({ snapshot: JSON.stringify(recipe) }).execute()
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
