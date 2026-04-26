import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  validateCreateRecipeInput,
  type ApiErrorResponse,
  type CreateRecipeResponse,
  type ListRecipesResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import {
  createRecipe,
  listRecentRecipes
} from '$lib/server/repositories/recipes';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

function couchUnreachable(): Response {
  const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
  return json(body, { status: 503 });
}

export const GET = async ({ url }: { url: URL }) => {
  const config = getServerConfig(env);
  const limit = clampLimit(url.searchParams.get('limit'));
  try {
    const recipes = await listRecentRecipes(config.couch, limit);
    const body: ListRecipesResponse = { recipes };
    return json(body);
  } catch {
    return couchUnreachable();
  }
};

export const POST = async ({ request }: { request: Request }) => {
  const config = getServerConfig(env);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    const body: ApiErrorResponse = { ok: false, error: 'Invalid JSON body' };
    return json(body, { status: 400 });
  }
  const result = validateCreateRecipeInput(payload);
  if (!result.ok) {
    const body: ApiErrorResponse = {
      ok: false,
      error: 'Invalid recipe input',
      details: result.errors
    };
    return json(body, { status: 400 });
  }
  try {
    const recipe = await createRecipe(config.couch, result.value);
    const body: CreateRecipeResponse = { recipe };
    return json(body, { status: 201 });
  } catch {
    return couchUnreachable();
  }
};
