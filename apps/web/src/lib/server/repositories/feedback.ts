import type { CreateFeedbackInput, FeedbackDoc, RecipeCode } from '@brewdial/shared';
import type { CouchConfig } from '../config';
import { getAllDocuments, putDocument } from '../couch';
import { NotFoundError } from '../errors';
import { getRecipeByCode } from './recipes';

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function addFeedback(
  config: CouchConfig,
  input: CreateFeedbackInput,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackDoc> {
  const recipe = await getRecipeByCode(config, input.recipeCode, fetchImpl);
  if (!recipe) {
    throw new NotFoundError(`Recipe ${input.recipeCode} not found`);
  }

  const now = new Date().toISOString();
  const id = `feedback:${input.recipeCode}:${now}-${randomSuffix()}`;
  const doc: FeedbackDoc = {
    _id: id,
    type: 'feedback',
    recipeCode: input.recipeCode,
    recipeId: `recipe:${input.recipeCode}`,
    ratings: input.ratings,
    source: input.source ?? 'web',
    createdAt: now,
    updatedAt: now
  };
  if (recipe.beanId !== undefined) doc.beanId = recipe.beanId;
  if (input.actual !== undefined) doc.actual = input.actual;
  if (input.comment !== undefined) doc.comment = input.comment;
  if (input.desiredDirection !== undefined) doc.desiredDirection = input.desiredDirection;
  if (input.nextHint !== undefined) doc.nextHint = input.nextHint;

  return putDocument(config, doc, fetchImpl);
}

export async function listFeedbackForRecipe(
  config: CouchConfig,
  recipeCode: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackDoc[]> {
  const docs = await getAllDocuments<FeedbackDoc>(
    config,
    {
      startkey: `feedback:${recipeCode}:`,
      endkey: `feedback:${recipeCode}:￰`,
      includeDocs: true
    },
    fetchImpl
  );
  return docs
    .slice()
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}
