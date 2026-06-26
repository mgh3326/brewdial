import type { CreateRecipeInput, RecipeCode, RecipeDoc } from '../domain';
import { validateCreateRecipeInput } from '../domain';
import { supabase } from '../supabase';
import { dbError } from '../labels';
import { apiGet } from '../api';
import { RECIPE_COLUMNS, rowToRecipe, type RecipeRow } from './mappers';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listRecentRecipes(limit = DEFAULT_LIMIT): Promise<RecipeDoc[]> {
  const safe = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const rows = await apiGet<RecipeRow[]>(`/recipes?limit=${safe}`);
  return rows.map(rowToRecipe);
}

export async function getRecipeByCode(code: RecipeCode): Promise<RecipeDoc | null> {
  const row = await apiGet<RecipeRow | null>(`/recipes/${encodeURIComponent(code)}`);
  return row ? rowToRecipe(row) : null;
}

// Active recipes for one bean (ROB-610 bean-centric view), newest first.
export async function listRecipesByBean(beanId: string): Promise<RecipeDoc[]> {
  const rows = await apiGet<RecipeRow[]>(`/recipes?beanId=${encodeURIComponent(beanId)}`);
  return rows.map(rowToRecipe);
}

// Anonymous clients can only create human ('manual') recipes — RLS enforces it.
// AI/agent recipes are created by the MCP server via the service role key.
export async function createRecipe(input: CreateRecipeInput): Promise<RecipeDoc> {
  const result = validateCreateRecipeInput(input);
  if (!result.ok) throw new Error(result.errors.join('; '));
  const r = result.value;

  const row = {
    method: r.method,
    title: r.title,
    version: 1,
    params: r.params ?? {},
    steps: r.steps ?? [],
    bean_id: r.beanId ?? null,
    bean_snapshot: r.beanSnapshot ?? null,
    intent: r.intent ?? null,
    notes: r.notes ?? null,
    adjustment_from_previous: r.adjustmentFromPrevious ?? null,
    created_by: 'manual' as const,
  };

  const { data, error } = await supabase
    .from('recipes')
    .insert(row)
    .select(RECIPE_COLUMNS)
    .single();
  if (error) throw dbError('createRecipe', error.message);
  return rowToRecipe(data as RecipeRow);
}
