import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';
import { validateCreateRecipeInput } from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { createRecipe } from '$lib/server/repositories/recipes';
import {
  formDataToRecipeValues,
  recipeValuesToInput
} from '$lib/forms/recipe-form';
import type { Actions } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

export const actions: Actions = {
  default: async ({ request }) => {
    const config = getServerConfig(env);
    const formData = await request.formData();
    const values = formDataToRecipeValues(formData);
    const input = recipeValuesToInput(values);
    const validation = validateCreateRecipeInput(input);
    if (!validation.ok) {
      return fail(400, { errors: validation.errors, values });
    }
    let code: string;
    try {
      const recipe = await createRecipe(config.couch, validation.value);
      code = recipe.code;
    } catch {
      return fail(503, { errors: [COUCH_UNREACHABLE], values });
    }
    throw redirect(303, `/recipes/${code}`);
  }
};
