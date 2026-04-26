import { env } from '$env/dynamic/private';
import type { RecipeDoc } from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { listRecentRecipes } from '$lib/server/repositories/recipes';
import type { PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

export const load: PageServerLoad = async ({ url }) => {
  const config = getServerConfig(env);
  const limit = clampLimit(url.searchParams.get('limit'));
  let recipes: RecipeDoc[] = [];
  let dbError: string | null = null;
  try {
    recipes = await listRecentRecipes(config.couch, limit);
  } catch {
    dbError = COUCH_UNREACHABLE;
  }
  return { recipes, dbError, limit };
};
