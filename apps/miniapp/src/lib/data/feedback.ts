import type { CreateFeedbackInput, FeedbackDoc, RecipeCode } from '../domain';
import { validateCreateFeedbackInput } from '../domain';
import { supabase } from '../supabase';
import { dbError } from '../labels';
import { apiGet } from '../api';
import { FEEDBACK_COLUMNS, rowToFeedback, type FeedbackRow } from './mappers';

export async function listFeedbackByRecipe(code: RecipeCode): Promise<FeedbackDoc[]> {
  const rows = await apiGet<FeedbackRow[]>(`/recipes/${encodeURIComponent(code)}/feedback`);
  return rows.map(rowToFeedback);
}

export async function createFeedback(input: CreateFeedbackInput): Promise<FeedbackDoc> {
  const result = validateCreateFeedbackInput(input);
  if (!result.ok) throw new Error(result.errors.join('; '));
  const f = result.value;

  const row = {
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

  const { data, error } = await supabase
    .from('feedback')
    .insert(row)
    .select(FEEDBACK_COLUMNS)
    .single();
  if (error) throw dbError('createFeedback', error.message);
  return rowToFeedback(data as FeedbackRow);
}
