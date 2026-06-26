import type { CreateFeedbackInput, FeedbackDoc, RecipeCode } from '../domain';
import { validateCreateFeedbackInput } from '../domain';
import { apiGet, apiSend } from '../api';
import { rowToFeedback, type FeedbackRow } from './mappers';

export async function listFeedbackByRecipe(code: RecipeCode): Promise<FeedbackDoc[]> {
  const rows = await apiGet<FeedbackRow[]>(`/recipes/${encodeURIComponent(code)}/feedback`);
  return rows.map(rowToFeedback);
}

export async function createFeedback(input: CreateFeedbackInput): Promise<FeedbackDoc> {
  const result = validateCreateFeedbackInput(input);
  if (!result.ok) throw new Error(result.errors.join('; '));
  const f = result.value;

  const body = {
    recipe_code: f.recipeCode,
    ratings: f.ratings ?? null,
    actual: f.actual ?? null,
    comment: f.comment ?? null,
    raw_comment: f.rawComment ?? null,
    quick_tags: f.quickTags ?? null,
    desired_direction: f.desiredDirection ?? null,
    next_hint: f.nextHint ?? null,
    source: f.source ?? 'web',
  };

  const row = await apiSend<FeedbackRow>('POST', `/recipes/${encodeURIComponent(f.recipeCode)}/feedback`, body);
  return rowToFeedback(row);
}
