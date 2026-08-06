import type { FeedbackDoc, RecipeCode } from '../domain';
import { apiGet } from '../api';
import { resolveIdentity } from '../identity';
import { rowToFeedback, type FeedbackRow } from './mappers';

export async function listFeedbackByRecipe(code: RecipeCode): Promise<FeedbackDoc[]> {
  const identity = await resolveIdentity();
  const rows = await apiGet<FeedbackRow[]>(`/recipes/${encodeURIComponent(code)}/feedback`, { identity });
  return rows.map(rowToFeedback);
}
