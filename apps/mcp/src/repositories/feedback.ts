import type { FeedbackDoc, RecipeCode } from '@brewdial/shared';
import type { CouchConfig } from '../config.js';
import { getAllDocuments } from '../couch.js';

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
