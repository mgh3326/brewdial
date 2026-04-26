import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  isRecipeCode,
  type ApiErrorResponse,
  type GetRecipeResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { getRecipeByCode } from '$lib/server/repositories/recipes';

export const GET = async ({ params }: { params: { code: string } }) => {
  const config = getServerConfig(env);
  const code = params.code;
  if (!isRecipeCode(code)) {
    const body: ApiErrorResponse = { ok: false, error: 'Invalid recipe code' };
    return json(body, { status: 400 });
  }
  try {
    const recipe = await getRecipeByCode(config.couch, code);
    if (!recipe) {
      const body: ApiErrorResponse = { ok: false, error: 'Recipe not found' };
      return json(body, { status: 404 });
    }
    const body: GetRecipeResponse = { recipe };
    return json(body);
  } catch {
    const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
    return json(body, { status: 503 });
  }
};
