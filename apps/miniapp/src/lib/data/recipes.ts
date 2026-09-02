import type { CreateRecipeInput, RecipeCode, RecipeDoc } from '../domain';
import { validateCreateRecipeInput, validateUpdateRecipeInput } from '../domain';
import { apiGet, apiGetOrNull, apiSend } from '../api';
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

// Anonymous clients can create only private human recipes. The API stamps the
// owner and canonical `manual` created_by value from the resolved identity.
export async function createRecipe(input: CreateRecipeInput): Promise<RecipeDoc> {
  const result = validateCreateRecipeInput(input);
  if (!result.ok) throw new Error(result.errors.join('; '));
  const value = result.value;
  const identity = await resolveIdentity();
  const body: Record<string, unknown> = {
    method: value.method,
    title: value.title,
    params: value.params ?? {},
    steps: value.steps ?? [],
  };
  if (value.beanId !== undefined) body.beanId = value.beanId;
  if (value.beanSnapshot !== undefined) body.beanSnapshot = value.beanSnapshot;
  if (value.intent !== undefined) body.intent = value.intent;
  if (value.notes !== undefined) body.notes = value.notes;
  if (value.adjustmentFromPrevious !== undefined) body.adjustmentFromPrevious = value.adjustmentFromPrevious;
  if (value.dripperPortability !== undefined) body.dripperPortability = value.dripperPortability;

  const row = await apiSend<RecipeRow>('POST', '/me/recipes', body, { identity });
  return rowToRecipe(row);
}

export async function updateRecipe(code: RecipeCode | string, input: unknown): Promise<RecipeDoc> {
  const result = validateUpdateRecipeInput(input);
  if (!result.ok) throw new Error(result.errors.join('; '));
  const identity = await resolveIdentity();
  const row = await apiSend<RecipeRow>(
    'PATCH',
    `/me/recipes/${encodeURIComponent(code)}`,
    result.value,
    { identity },
  );
  return rowToRecipe(row);
}

export async function deleteRecipe(code: RecipeCode | string): Promise<void> {
  const identity = await resolveIdentity();
  await apiSend('DELETE', `/me/recipes/${encodeURIComponent(code)}`, undefined, { identity });
}
