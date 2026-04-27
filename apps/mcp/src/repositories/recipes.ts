import type { CreateRecipeInput, RecipeCode, RecipeDoc } from '@brewdial/shared';
import type { CouchConfig } from '../config.js';
import { getAllDocuments, getDocument, putDocument } from '../couch.js';
import { nextRecipeCode } from './counters.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function createRecipe(
  config: CouchConfig,
  input: CreateRecipeInput,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc> {
  const code = await nextRecipeCode(config, fetchImpl);
  const now = new Date().toISOString();
  const doc: RecipeDoc = {
    _id: `recipe:${code}`,
    type: 'recipe',
    code,
    method: input.method,
    title: input.title,
    version: 1,
    params: input.params ?? {},
    steps: input.steps ?? [],
    createdBy: input.createdBy ?? 'agent',
    createdAt: now,
    updatedAt: now
  };
  if (input.beanId !== undefined) doc.beanId = input.beanId;
  if (input.beanSnapshot !== undefined) doc.beanSnapshot = input.beanSnapshot;
  if (input.intent !== undefined) doc.intent = input.intent;
  if (input.notes !== undefined) doc.notes = input.notes;
  if (input.adjustmentFromPrevious !== undefined) {
    doc.adjustmentFromPrevious = input.adjustmentFromPrevious;
  }
  return putDocument(config, doc, fetchImpl);
}

export async function getRecipeByCode(
  config: CouchConfig,
  code: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc | null> {
  return getDocument<RecipeDoc>(config, `recipe:${code}`, fetchImpl);
}

export async function listRecentRecipes(
  config: CouchConfig,
  limit: number = DEFAULT_LIMIT,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const docs = await getAllDocuments<RecipeDoc>(
    config,
    {
      startkey: 'recipe:',
      endkey: 'recipe:￰',
      includeDocs: true
    },
    fetchImpl
  );
  return docs
    .slice()
    .sort((a: RecipeDoc, b: RecipeDoc) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, safeLimit);
}
