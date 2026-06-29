import { describe, it, expect, afterAll } from 'vitest'
import { sql } from 'kysely'
import { getDb, closeDb } from '../db.js'
import { insertManualRecipe, getRecipeAnyStatus } from './recipes.js'

// Regression: jsonb columns (steps/params/bean_snapshot) must be JSON-serialized
// before insert. pg turns a top-level JS array (steps) into a Postgres array
// literal, which a jsonb column rejects with 22P02 "invalid input syntax for type
// json". This test inserts a recipe with a NON-EMPTY steps array against the real DB.

const db = getDb()

afterAll(async () => {
  await closeDb()
})

describe('insertManualRecipe — jsonb serialization', () => {
  it('stores a non-empty steps array (no 22P02) and round-trips it as an array', async () => {
    const row = await insertManualRecipe(db, {
      method: 'v60',
      title: '__jsonb_regression_test__',
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

      // Read back through a fresh select to confirm it persisted as jsonb (not a
      // Postgres array literal or stringified text).
      const back = await getRecipeAnyStatus(db, row.code)
      expect(Array.isArray(back?.steps)).toBe(true)
      expect((back?.steps as unknown[]).length).toBe(2)
    } finally {
      await sql`delete from recipes where code = ${row.code}`.execute(db)
    }
  })
})
