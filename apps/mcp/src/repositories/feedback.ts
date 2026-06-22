import type { CreateFeedbackInput, FeedbackDoc, RecipeCode } from '@brewdial/shared';
import type { SupabaseConfig } from '../config.js';
import { insertRow, selectRows } from '../supabase.js';
import { FEEDBACK_COLUMNS, feedbackToInsertRow, rowToFeedback, type FeedbackRow } from '../mappers.js';
import { getRecipeByCode } from './recipes.js';

export class NotFoundError extends Error {}

export async function createFeedback(
  config: SupabaseConfig,
  input: CreateFeedbackInput,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackDoc> {
  // Service role bypasses RLS, so MCP may store agent/coffee_profile sources.
  const recipe = await getRecipeByCode(config, input.recipeCode, fetchImpl);
  if (!recipe) throw new NotFoundError(`Recipe ${input.recipeCode} not found`);

  const row = await insertRow<FeedbackRow>(
    config,
    'feedback',
    feedbackToInsertRow(input, recipe.beanId ?? null),
    FEEDBACK_COLUMNS,
    fetchImpl
  );
  return rowToFeedback(row);
}

export async function listFeedbackForRecipe(
  config: SupabaseConfig,
  recipeCode: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackDoc[]> {
  const rows = await selectRows<FeedbackRow>(
    config,
    'feedback',
    `recipe_code=eq.${encodeURIComponent(recipeCode)}&select=${FEEDBACK_COLUMNS}&order=created_at.asc`,
    fetchImpl
  );
  return rows.map(rowToFeedback);
}
