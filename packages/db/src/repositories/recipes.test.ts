import { describe, it, expect, afterAll } from 'vitest'
import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'
import { getDb, closeDb } from '../db.js'
import {
  insertManualRecipe,
  getRecipeAnyStatus,
  getRecipeByCode,
  listRecentRecipes,
  listRecipesByBean,
  setRecipeStatus,
} from './recipes.js'
import { saveRecipe } from './saved.js'

// Regression: json columns (steps/params/bean_snapshot) must be JSON-serialized
// before insert. mysql2 expands a top-level JS array (steps) into a SQL list, which a
// json column rejects. This test inserts a recipe with a NON-EMPTY steps array against the real DB.

const db = getDb()

afterAll(async () => {
  await closeDb()
})

describe('insertManualRecipe — jsonb serialization', () => {
  it('stores a non-empty steps array (no json type error) and round-trips it as an array', async () => {
    const row = await insertManualRecipe(db, {
      method: 'v60',
      title: '__json_regression_test__',
      params: { doseG: 20, waterG: 320 },
      steps: [
        { atSec: 0, waterG: 50, note: 'Bloom' },
        { atSec: 45, waterG: 140, note: 'Pour 1' },
      ],
    } as Parameters<typeof insertManualRecipe>[1])

    try {
      expect(Array.isArray(row.steps)).toBe(true)
      expect((row.steps as unknown[]).length).toBe(2)
      expect((row.steps as Array<{ note: string }>)[0].note).toBe('Bloom')
      expect((row.params as { doseG: number }).doseG).toBe(20)

      // Read back through a fresh select to confirm it persisted as json (not a
      // SQL list or stringified text).
      const back = await getRecipeAnyStatus(db, row.code)
      expect(Array.isArray(back?.steps)).toBe(true)
      expect((back?.steps as unknown[]).length).toBe(2)
    } finally {
      await sql`delete from recipes where code = ${row.code}`.execute(db)
    }
  })
})

// #588: status='reference' rows are held for agent-only explicit access —
// they must not leak into any user-facing list/save path.
describe("status='reference' list exclusion", () => {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
  const refCode = `T-DBREF-${suffix}`
  const beanId = randomUUID()
  const appUserId = randomUUID()
  let userCreated = false

  afterAll(async () => {
    await sql`delete from saved_recipes where app_user_id = ${appUserId}`.execute(db)
    if (userCreated) await sql`delete from app_users where id = ${appUserId}`.execute(db)
    await sql`delete from recipes where code = ${refCode}`.execute(db)
    await sql`delete from beans where id = ${beanId}`.execute(db)
  })

  it('is excluded from recent/by-bean lists and web getByCode, reachable via any-status', async () => {
    await sql`insert into beans (id, name) values (${beanId}, ${'Ref Bean ' + suffix})`.execute(db)
    await db
      .insertInto('recipes')
      .values({ code: refCode, method: 'v60', title: 'Repo Ref Recipe', status: 'reference', bean_id: beanId, owner_id: null })
      .execute()

    const recent = await listRecentRecipes(db, 100)
    expect(recent.map((r) => r.code)).not.toContain(refCode)

    const byBean = await listRecipesByBean(db, beanId)
    expect(byBean.map((r) => r.code)).not.toContain(refCode)

    // Web path (status not in test/reference) hides it; agent any-status read returns it.
    expect(await getRecipeByCode(db, refCode)).toBeUndefined()
    const explicit = await getRecipeAnyStatus(db, refCode)
    expect(explicit?.code).toBe(refCode)
    expect(explicit?.status).toBe('reference')
  })

  it('saveRecipe writes no saved_recipes row for a reference recipe', async () => {
    await sql`insert into app_users (id) values (${appUserId})`.execute(db)
    userCreated = true

    await saveRecipe(db, appUserId, refCode)
    const rows = await sql<{ n: number | string }>`
      select count(*) as n from saved_recipes
      where app_user_id = ${appUserId} and recipe_code = ${refCode}`.execute(db)
    expect(Number(rows.rows[0].n)).toBe(0)
  })

  it('setRecipeStatus accepts reference and still rejects junk', async () => {
    const row = await setRecipeStatus(db, refCode, 'reference')
    expect(row.status).toBe('reference')
    await expect(setRecipeStatus(db, refCode, 'bogus')).rejects.toMatchObject({ code: 'INVALID_STATUS' })
  })
})
