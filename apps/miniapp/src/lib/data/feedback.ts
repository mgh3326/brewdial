import type { CreateFeedbackInput, FeedbackDoc, RecipeCode } from '../domain';
import { validateCreateFeedbackInput } from '../domain';
import { apiGet, apiSend } from '../api';
import { resolveIdentity } from '../identity';
import { rowToFeedback, type FeedbackRow } from './mappers';

export async function listFeedbackByRecipe(code: RecipeCode): Promise<FeedbackDoc[]> {
  const identity = await resolveIdentity();
  const rows = await apiGet<FeedbackRow[]>(`/recipes/${encodeURIComponent(code)}/feedback`, { identity });
  return rows.map(rowToFeedback);
}

export async function createFeedback(input: CreateFeedbackInput): Promise<FeedbackDoc> {
  const result = validateCreateFeedbackInput(input);
  if (!result.ok) throw new Error(result.errors.join('; '));
  const value = result.value;
  const identity = await resolveIdentity();
  const body: Record<string, unknown> = { source: 'web' };
  if (value.ratings !== undefined) body.ratings = value.ratings;
  if (value.actual !== undefined) body.actual = value.actual;
  if (value.comment !== undefined) body.comment = value.comment;
  if (value.rawComment !== undefined) body.rawComment = value.rawComment;
  if (value.quickTags !== undefined) body.quickTags = value.quickTags;
  if (value.desiredDirection !== undefined) body.desiredDirection = value.desiredDirection;
  if (value.nextHint !== undefined) body.nextHint = value.nextHint;

  const row = await apiSend<FeedbackRow>(
    'POST',
    `/me/recipes/${encodeURIComponent(value.recipeCode)}/feedback`,
    body,
    { identity },
  );
  return rowToFeedback(row);
}
