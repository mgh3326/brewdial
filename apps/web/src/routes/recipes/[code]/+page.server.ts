import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { isRecipeCode, type FeedbackDoc, type RecipeDoc } from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { getRecipeByCode } from '$lib/server/repositories/recipes';
import { listFeedbackForRecipe } from '$lib/server/repositories/feedback';
import type { PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

export const load: PageServerLoad = async ({ params }) => {
  if (!isRecipeCode(params.code)) {
    throw error(404, 'Recipe not found');
  }
  const config = getServerConfig(env);

  let recipe: RecipeDoc | null;
  try {
    recipe = await getRecipeByCode(config.couch, params.code);
  } catch {
    throw error(503, COUCH_UNREACHABLE);
  }
  if (!recipe) {
    throw error(404, 'Recipe not found');
  }

  let feedback: FeedbackDoc[] = [];
  let feedbackError: string | null = null;
  try {
    feedback = await listFeedbackForRecipe(config.couch, params.code);
  } catch {
    feedbackError = COUCH_UNREACHABLE;
  }

  return { recipe, feedback, feedbackError };
};
