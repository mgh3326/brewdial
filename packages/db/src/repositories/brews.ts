import { sql, type Kysely } from 'kysely'
import type { XBloomBrew, XBloomBrewMetrics } from '@brewdial/shared'
import { deriveXBloomBrewMetrics } from '@brewdial/shared'
import type { DB } from '../types.js'
import { dbVendor } from '../db.js'

export interface BrewRow extends XBloomBrewMetrics {
  xbloomBrewId: string
  brewedAt: string
  brewTimeSec: number
  recipeName: string
  xbloomRecipeId: string | null
  recipeSnapshot: unknown
  curve?: unknown
  recipeCode?: string | null
  recipeTitle?: string | null
  recipeVersion?: number | null
}

export interface BrewInsertResult { inserted: string[]; duplicate: string[] }
export interface ListBrewsOptions { limit?: number; recipeCode?: string; xbloomRecipeId?: string; since?: string }

function jsonValue(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function toBrew(row: Record<string, unknown>, includeCurve: boolean): BrewRow {
  return {
    xbloomBrewId: String(row['xbloom_brew_id']),
    brewedAt: row['brewed_at'] instanceof Date ? row['brewed_at'].toISOString() : new Date(String(row['brewed_at'])).toISOString(),
    brewTimeSec: Number(row['brew_time_sec']), recipeName: String(row['recipe_name']),
    xbloomRecipeId: row['xbloom_recipe_id'] == null ? null : String(row['xbloom_recipe_id']),
    totalWaterMl: Number(row['total_water_ml']), finalCupG: Number(row['final_cup_g']), retentionG: Number(row['retention_g']),
    pourEndSec: Number(row['pour_end_sec']), cupAtPourEndG: Number(row['cup_at_pour_end_g']), drawdownSec: Number(row['drawdown_sec']),
    earlyDrawdownGPerSec: Number(row['early_drawdown_g_per_sec']), recipeSnapshot: jsonValue(row['recipe_snapshot']),
    ...(includeCurve ? { curve: jsonValue(row['curve']) } : {}),
    ...(Object.hasOwn(row, 'recipe_code') ? { recipeCode: row['recipe_code'] as string | null, recipeTitle: row['recipe_title'] as string | null, recipeVersion: row['recipe_version'] == null ? null : Number(row['recipe_version']) } : {})
  }
}

export async function insertXBloomBrews(db: Kysely<DB>, brews: XBloomBrew[]): Promise<BrewInsertResult> {
  const inserted: string[] = []
  const duplicate: string[] = []
  for (const brew of brews) {
    const metrics = deriveXBloomBrewMetrics(brew)
    const values = {
      xbloom_brew_id: brew.xbloomBrewId, brewed_at: new Date(brew.brewedAt), brew_time_sec: brew.brewTimeSec,
      recipe_name: brew.recipeName, xbloom_recipe_id: brew.xbloomRecipeId, ...{
        total_water_ml: metrics.totalWaterMl, final_cup_g: metrics.finalCupG, retention_g: metrics.retentionG,
        pour_end_sec: metrics.pourEndSec, cup_at_pour_end_g: metrics.cupAtPourEndG, drawdown_sec: metrics.drawdownSec,
        early_drawdown_g_per_sec: metrics.earlyDrawdownGPerSec
      },
      recipe_snapshot: JSON.stringify(brew.recipeSnapshot), curve: JSON.stringify(brew.curve)
    }
    const query = db.insertInto('brews').values(values)
    const result = dbVendor() === 'mysql'
      ? await query.onDuplicateKeyUpdate({ xbloom_brew_id: sql`xbloom_brew_id` }).executeTakeFirst()
      : await query.onConflict((conflict) => conflict.column('xbloom_brew_id').doNothing()).executeTakeFirst()
    const affected = Number(result.numInsertedOrUpdatedRows ?? 0)
    if (affected > 0) inserted.push(brew.xbloomBrewId)
    else duplicate.push(brew.xbloomBrewId)
  }
  return { inserted, duplicate }
}

export async function upsertXBloomRecipeLink(db: Kysely<DB>, xbloomRecipeId: string, recipeCode: string): Promise<void> {
  const now = new Date()
  const query = db.insertInto('xbloom_recipe_links').values({ xbloom_recipe_id: xbloomRecipeId, recipe_code: recipeCode, created_at: now, updated_at: now })
  if (dbVendor() === 'mysql') {
    await query.onDuplicateKeyUpdate({ recipe_code: recipeCode, updated_at: now }).execute()
  } else {
    await query.onConflict((conflict) => conflict.column('xbloom_recipe_id').doUpdateSet({ recipe_code: recipeCode, updated_at: now })).execute()
  }
}

export async function listXBloomRecipeLinks(db: Kysely<DB>) {
  return db.selectFrom('xbloom_recipe_links').innerJoin('recipes', 'recipes.code', 'xbloom_recipe_links.recipe_code')
    .select(['xbloom_recipe_links.xbloom_recipe_id as xbloomRecipeId', 'xbloom_recipe_links.recipe_code as recipeCode', 'recipes.title as recipeTitle', 'xbloom_recipe_links.created_at as createdAt', 'xbloom_recipe_links.updated_at as updatedAt'])
    .orderBy('xbloom_recipe_links.xbloom_recipe_id').execute()
}

export async function listXBloomBrews(db: Kysely<DB>, options: ListBrewsOptions = {}): Promise<BrewRow[]> {
  let query = db.selectFrom('brews').leftJoin('xbloom_recipe_links', 'xbloom_recipe_links.xbloom_recipe_id', 'brews.xbloom_recipe_id')
    .leftJoin('recipes', 'recipes.code', 'xbloom_recipe_links.recipe_code')
    .select(['brews.xbloom_brew_id', 'brews.brewed_at', 'brews.brew_time_sec', 'brews.recipe_name', 'brews.xbloom_recipe_id', 'brews.total_water_ml', 'brews.final_cup_g', 'brews.retention_g', 'brews.pour_end_sec', 'brews.cup_at_pour_end_g', 'brews.drawdown_sec', 'brews.early_drawdown_g_per_sec', 'brews.recipe_snapshot', 'recipes.code as recipe_code', 'recipes.title as recipe_title', 'recipes.version as recipe_version'])
  if (options.recipeCode) query = query.where('recipes.code', '=', options.recipeCode)
  if (options.xbloomRecipeId) query = query.where('brews.xbloom_recipe_id', '=', options.xbloomRecipeId)
  if (options.since) query = query.where('brews.brewed_at', '>=', new Date(options.since))
  const rows = await query.orderBy('brews.brewed_at', 'desc').limit(Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)))).execute()
  return rows.map((row) => toBrew(row as unknown as Record<string, unknown>, false))
}

export async function getXBloomBrew(db: Kysely<DB>, id: string): Promise<BrewRow | null> {
  const row = await db.selectFrom('brews').leftJoin('xbloom_recipe_links', 'xbloom_recipe_links.xbloom_recipe_id', 'brews.xbloom_recipe_id')
    .leftJoin('recipes', 'recipes.code', 'xbloom_recipe_links.recipe_code')
    .select(['brews.xbloom_brew_id', 'brews.brewed_at', 'brews.brew_time_sec', 'brews.recipe_name', 'brews.xbloom_recipe_id', 'brews.total_water_ml', 'brews.final_cup_g', 'brews.retention_g', 'brews.pour_end_sec', 'brews.cup_at_pour_end_g', 'brews.drawdown_sec', 'brews.early_drawdown_g_per_sec', 'brews.recipe_snapshot', 'brews.curve', 'recipes.code as recipe_code', 'recipes.title as recipe_title', 'recipes.version as recipe_version'])
    .where('brews.xbloom_brew_id', '=', id).executeTakeFirst()
  return row ? toBrew(row as unknown as Record<string, unknown>, true) : null
}

export async function listPriorXBloomBrewMetrics(db: Kysely<DB>, brew: BrewRow) {
  if (!brew.xbloomRecipeId) return []
  const rows = await db.selectFrom('brews').select(['brew_time_sec', 'drawdown_sec', 'early_drawdown_g_per_sec', 'final_cup_g', 'cup_at_pour_end_g'])
    .where('xbloom_recipe_id', '=', brew.xbloomRecipeId).where('brewed_at', '<', new Date(brew.brewedAt))
    .orderBy('brewed_at', 'desc').limit(10).execute()
  return rows.map((row) => ({
    brewTimeSec: Number(row.brew_time_sec), drawdownSec: Number(row.drawdown_sec), earlyDrawdownGPerSec: Number(row.early_drawdown_g_per_sec),
    finalCupG: Number(row.final_cup_g), cupAtPourEndG: Number(row.cup_at_pour_end_g)
  }))
}

export async function recipeExists(db: Kysely<DB>, code: string): Promise<boolean> {
  const row = await db.selectFrom('recipes').select('code').where('code', '=', code).executeTakeFirst()
  return !!row
}
