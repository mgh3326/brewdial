import type { CreateRecipeInput, RecipeCode, RecipeDoc } from '../domain';
import { validateCreateRecipeInput } from '../domain';
import { apiGet, apiGetOrNull, apiSend } from '../api';
import { rowToRecipe, type RecipeRow } from './mappers';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listRecentRecipes(limit = DEFAULT_LIMIT): Promise<RecipeDoc[]> {
  const safe = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const rows = await apiGet<RecipeRow[]>(`/recipes?limit=${safe}`);
  return rows.map(rowToRecipe);
}

export async function getRecipeByCode(code: RecipeCode): Promise<RecipeDoc | null> {
  const row = await apiGetOrNull<RecipeRow>(`/recipes/${encodeURIComponent(code)}`);
  return row ? rowToRecipe(row) : null;
}

// Active recipes for one bean (ROB-610 bean-centric view), newest first.
export async function listRecipesByBean(beanId: string): Promise<RecipeDoc[]> {
  const rows = await apiGet<RecipeRow[]>(`/recipes?beanId=${encodeURIComponent(beanId)}`);
  return rows.map(rowToRecipe);
}

// Anonymous clients can only create human ('manual') recipes — server enforces it.
// AI/agent recipes are created by the MCP server via the service role key.
export async function createRecipe(input: CreateRecipeInput): Promise<RecipeDoc> {
  const result = validateCreateRecipeInput(input);
  if (!result.ok) throw new Error(result.errors.join('; '));
  const r = result.value;

  // camelCase keys matching validateCreateRecipeInput; optional fields are OMITTED
  // when absent (the backend validator treats `null` as a type error, only
  // `undefined`/missing as optional).
  const body: Record<string, unknown> = {
    method: r.method,
    title: r.title,
    params: r.params ?? {},
    steps: r.steps ?? [],
  };
  if (r.beanId !== undefined) body.beanId = r.beanId;
  if (r.beanSnapshot !== undefined) body.beanSnapshot = r.beanSnapshot;
  if (r.intent !== undefined) body.intent = r.intent;
  if (r.notes !== undefined) body.notes = r.notes;
  if (r.adjustmentFromPrevious !== undefined) body.adjustmentFromPrevious = r.adjustmentFromPrevious;
  if (r.dripperPortability !== undefined) body.dripperPortability = r.dripperPortability;

  const row = await apiSend<RecipeRow>('POST', '/recipes', body);
  return rowToRecipe(row);
}
