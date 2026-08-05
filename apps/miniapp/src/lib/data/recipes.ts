import type { RecipeCode, RecipeDoc } from '../domain';
import { apiGet, apiGetOrNull } from '../api';
import { resolveIdentity } from '../identity';
import { rowToRecipe, type RecipeRow } from './mappers';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listRecentRecipes(limit = DEFAULT_LIMIT): Promise<RecipeDoc[]> {
  const safe = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const rows = await apiGet<RecipeRow[]>(`/recipes?limit=${safe}`);
  return rows.map(rowToRecipe);
}

export async function getRecipeByCode(code: RecipeCode): Promise<RecipeDoc | null> {
  const identity = await resolveIdentity();
  const row = await apiGetOrNull<RecipeRow>(`/recipes/${encodeURIComponent(code)}`, { identity });
  return row ? rowToRecipe(row) : null;
}

// Active recipes for one bean (ROB-610 bean-centric view), newest first.
export async function listRecipesByBean(beanId: string): Promise<RecipeDoc[]> {
  const identity = await resolveIdentity();
  const rows = await apiGet<RecipeRow[]>(`/recipes?beanId=${encodeURIComponent(beanId)}`, { identity });
  return rows.map(rowToRecipe);
}
