import { env } from '$env/dynamic/private';
import { getServerConfig } from '$lib/server/config';
import {
  listRecipesPage,
  DEFAULT_PAGE_SIZE,
  type RecipePage
} from '$lib/server/repositories/recipes';
import type { PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

function parsePage(raw: string | null): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

export const load: PageServerLoad = async ({ url }) => {
  const config = getServerConfig(env);
  const page = parsePage(url.searchParams.get('page'));
  let result: RecipePage = {
    recipes: [],
    total: 0,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    totalPages: 1
  };
  let dbError: string | null = null;
  try {
    result = await listRecipesPage(config.couch, { page });
  } catch {
    dbError = COUCH_UNREACHABLE;
  }
  return { ...result, dbError };
};
