import type { CreateRecipeInput, RecipeCode, RecipeDoc } from '../domain';
import { validateCreateRecipeInput } from '../domain';
import { supabase } from '../supabase';
import { RECIPE_COLUMNS, rowToRecipe, type RecipeRow } from './mappers';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listRecentRecipes(limit = DEFAULT_LIMIT): Promise<RecipeDoc[]> {
  const safe = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const { data, error } = await supabase
    .from('recipes')
    .select(RECIPE_COLUMNS)
    .eq('status', 'active') // ROB-609: hide superseded/archived/test by default
    .order('created_at', { ascending: false })
    .limit(safe);
  if (error) throw new Error(error.message);
  return (data as RecipeRow[]).map(rowToRecipe);
}

export async function getRecipeByCode(code: RecipeCode): Promise<RecipeDoc | null> {
  const { data, error } = await supabase
    .from('recipes')
    .select(RECIPE_COLUMNS)
    .eq('code', code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToRecipe(data as RecipeRow) : null;
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
  if (error) throw new Error(error.message);
  return rowToRecipe(data as RecipeRow);
}
