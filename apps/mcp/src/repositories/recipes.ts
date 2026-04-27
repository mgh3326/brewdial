import type { RecipeCode, RecipeDoc } from '@brewdial/shared';
import type { CouchConfig } from '../config.js';
import { getAllDocuments, getDocument } from '../couch.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
