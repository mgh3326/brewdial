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
  const f = result.value;
  const identity = await resolveIdentity();

  // Optional fields OMITTED when absent — the backend validator treats `null`
  // as a type error (e.g. "quickTags must be a string array"), only undefined/missing as optional.
  const body: Record<string, unknown> = { source: f.source ?? 'web' };
  if (f.ratings !== undefined) body.ratings = f.ratings;
  if (f.actual !== undefined) body.actual = f.actual;
  if (f.comment !== undefined) body.comment = f.comment;
  if (f.rawComment !== undefined) body.rawComment = f.rawComment;
  if (f.quickTags !== undefined) body.quickTags = f.quickTags;
  if (f.desiredDirection !== undefined) body.desiredDirection = f.desiredDirection;
  if (f.nextHint !== undefined) body.nextHint = f.nextHint;

  const row = await apiSend<FeedbackRow>('POST', `/recipes/${encodeURIComponent(f.recipeCode)}/feedback`, body, { identity });
  return rowToFeedback(row);
}
