import { env } from '$env/dynamic/private';
import type { RecipeDoc } from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { listRecentRecipes } from '$lib/server/repositories/recipes';
import type { PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

export const load: PageServerLoad = async () => {
  const config = getServerConfig(env);
  let recipes: RecipeDoc[] = [];
  let dbError: string | null = null;
  try {
    recipes = await listRecentRecipes(config.couch, 5);
  } catch {
    dbError = COUCH_UNREACHABLE;
  }
  return { recipes, dbError };
};
