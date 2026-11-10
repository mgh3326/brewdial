import type { ApiConfig } from '../config.js'
import { ApiError, getJson, putJson } from '../api.js'

export interface McpBrewRow {
  xbloomBrewId: string
  brewedAt: string
  brewTimeSec: number
  recipeName: string
  xbloomRecipeId: string | null
  totalWaterMl: number
  finalCupG: number
  retentionG: number
  pourEndSec: number
  cupAtPourEndG: number
  drawdownSec: number
  earlyDrawdownGPerSec: number
  curve?: Array<[number, number]>
  [key: string]: unknown
}

export interface ListBrewsFilters { limit?: number; recipeCode?: string; xbloomRecipeId?: string; since?: string }
export interface XBloomRecipeLink { xbloomRecipeId: string; recipeCode: string }

export function listXBloomRecipeLinks(config: ApiConfig, fetchImpl?: typeof fetch): Promise<XBloomRecipeLink[]> {
  return getJson(config, '/api/agent/xbloom-recipe-links', '', fetchImpl)
}

function queryString(filters: ListBrewsFilters): string {
  const params = new URLSearchParams()
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  if (filters.recipeCode) params.set('recipeCode', filters.recipeCode)
  if (filters.xbloomRecipeId) params.set('xbloomRecipeId', filters.xbloomRecipeId)
  if (filters.since) params.set('since', filters.since)
  return params.toString()
}

export function listBrews(config: ApiConfig, filters: ListBrewsFilters = {}, fetchImpl?: typeof fetch): Promise<McpBrewRow[]> {
  return getJson(config, '/api/agent/brews', queryString(filters), fetchImpl)
}

export async function getBrew(config: ApiConfig, id: string, fetchImpl?: typeof fetch): Promise<McpBrewRow | null> {
  try {
    return await getJson(config, `/api/agent/brews/${encodeURIComponent(id)}`, '', fetchImpl)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export function linkXBloomRecipe(config: ApiConfig, id: string, recipeCode: string, fetchImpl?: typeof fetch): Promise<{ xbloomRecipeId: string; recipeCode: string }> {
  return putJson(config, `/api/agent/xbloom-recipe-links/${encodeURIComponent(id)}`, { recipeCode }, fetchImpl)
}
