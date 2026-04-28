import type { CreateFeedbackInput, FeedbackDoc, RecipeCode } from '@brewdial/shared';
import type { CouchConfig } from '../config.js';
import { getAllDocuments, getDocument, putDocument } from '../couch.js';

export class NotFoundError extends Error {}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function createFeedback(
  config: CouchConfig,
  input: CreateFeedbackInput,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackDoc> {
  const recipe = await getDocument<FeedbackDoc & { beanId?: string }>(
    config,
    `recipe:${input.recipeCode}`,
    fetchImpl
  );
  if (!recipe) throw new NotFoundError(`Recipe ${input.recipeCode} not found`);

  const now = new Date().toISOString();
  const id = `feedback:${input.recipeCode}:${now}-${randomSuffix()}`;
  const doc: FeedbackDoc = {
    _id: id,
    type: 'feedback',
    recipeCode: input.recipeCode,
    recipeId: `recipe:${input.recipeCode}`,
    source: input.source ?? 'coffee_profile',
    createdAt: now,
    updatedAt: now
  };
  if (recipe.beanId !== undefined) doc.beanId = recipe.beanId;
  if (input.ratings && Object.keys(input.ratings).length > 0) doc.ratings = input.ratings;
  if (input.actual) doc.actual = input.actual;
  if (input.rawComment) {
    doc.rawComment = input.rawComment;
    doc.comment = input.comment ?? input.rawComment;
  } else if (input.comment !== undefined) {
    doc.comment = input.comment;
  }
  if (input.quickTags && input.quickTags.length > 0) doc.quickTags = input.quickTags;
  if (input.desiredDirection) doc.desiredDirection = input.desiredDirection;
  if (input.nextHint) doc.nextHint = input.nextHint;

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
    .sort((a: FeedbackDoc, b: FeedbackDoc) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}
