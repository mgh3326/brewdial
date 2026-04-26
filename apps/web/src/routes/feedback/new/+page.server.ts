import { env } from '$env/dynamic/private';
import { error, fail, redirect } from '@sveltejs/kit';
import {
  isRecipeCode,
  validateCreateFeedbackInput,
  type RecipeDoc
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { getRecipeByCode } from '$lib/server/repositories/recipes';
import { addFeedback } from '$lib/server/repositories/feedback';
import { NotFoundError } from '$lib/server/errors';
import {
  feedbackValuesToInput,
  formDataToFeedbackValues
} from '$lib/forms/feedback-form';
import type { Actions, PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

export const load: PageServerLoad = async ({ url }) => {
  const recipeCode = url.searchParams.get('recipeCode');
  if (!recipeCode || !isRecipeCode(recipeCode)) {
    throw error(404, 'Recipe not found');
  }
  const config = getServerConfig(env);
  let recipe: RecipeDoc | null;
  try {
    recipe = await getRecipeByCode(config.couch, recipeCode);
  } catch {
    return { recipe: null, dbError: COUCH_UNREACHABLE };
  }
  if (!recipe) {
    throw error(404, 'Recipe not found');
  }
  return { recipe, dbError: null };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const config = getServerConfig(env);
    const formData = await request.formData();
    const values = formDataToFeedbackValues(formData);
    const input = feedbackValuesToInput(values);
    const validation = validateCreateFeedbackInput(input);
    if (!validation.ok) {
      return fail(400, { errors: validation.errors, values });
    }
    try {
      await addFeedback(config.couch, validation.value);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return fail(404, { errors: [err.message], values });
      }
      return fail(503, { errors: [COUCH_UNREACHABLE], values });
    }
    throw redirect(303, `/recipes/${validation.value.recipeCode}`);
  }
};
