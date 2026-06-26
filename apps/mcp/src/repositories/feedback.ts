import type { CreateFeedbackInput, FeedbackDoc, RecipeCode } from '@brewdial/shared';
import type { ApiConfig } from '../config.js';
import { getJson, postJson } from '../api.js';
import { rowToFeedback, type FeedbackRow } from '../mappers.js';
import { getRecipeByCode } from './recipes.js';

export class NotFoundError extends Error {}

export async function createFeedback(
  config: ApiConfig,
  input: CreateFeedbackInput,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackDoc> {
  // Agent feedback: POST /api/agent/feedback with camelCase body.
  // The endpoint verifies recipe existence and returns the inserted row.
  const body: Record<string, unknown> = {
    recipeCode: input.recipeCode,
    source: input.source ?? 'agent',
  };
  if (input.ratings !== undefined) body.ratings = input.ratings;
  if (input.actual !== undefined) body.actual = input.actual;
  if (input.comment !== undefined) body.comment = input.comment;
  if (input.rawComment !== undefined) body.rawComment = input.rawComment;
  if (input.quickTags !== undefined) body.quickTags = input.quickTags;
  if (input.desiredDirection !== undefined) body.desiredDirection = input.desiredDirection;
  if (input.nextHint !== undefined) body.nextHint = input.nextHint;

  const row = await postJson<FeedbackRow>(config, '/api/agent/feedback', body, fetchImpl);
  return rowToFeedback(row);
}

export async function listFeedbackForRecipe(
  config: ApiConfig,
  recipeCode: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackDoc[]> {
  // GET /api/recipes/:code/feedback — public read endpoint.
  const rows = await getJson<FeedbackRow[]>(
    config,
    `/api/recipes/${encodeURIComponent(recipeCode)}/feedback`,
    '',
    fetchImpl
  );
  return (Array.isArray(rows) ? rows : []).map(rowToFeedback);
}

// Re-export for context.ts (used to validate recipe before feedback).
export { getRecipeByCode };
