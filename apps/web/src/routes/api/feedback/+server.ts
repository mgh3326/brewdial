import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  isRecipeCode,
  validateCreateFeedbackInput,
  type ApiErrorResponse,
  type CreateFeedbackResponse,
  type ListFeedbackResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { NotFoundError } from '$lib/server/errors';
import {
  addFeedback,
  listFeedbackForRecipe
} from '$lib/server/repositories/feedback';

function couchUnreachable(): Response {
  const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
  return json(body, { status: 503 });
}

export const GET = async ({ url }: { url: URL }) => {
  const config = getServerConfig(env);
  const recipeCode = url.searchParams.get('recipeCode');
  if (!recipeCode) {
    const body: ApiErrorResponse = {
      ok: false,
      error: 'recipeCode query parameter is required'
    };
    return json(body, { status: 400 });
  }
  if (!isRecipeCode(recipeCode)) {
    const body: ApiErrorResponse = {
      ok: false,
      error: 'recipeCode must match COF-NNNN'
    };
    return json(body, { status: 400 });
  }
  try {
    const feedback = await listFeedbackForRecipe(config.couch, recipeCode);
    const body: ListFeedbackResponse = { feedback };
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
  const result = validateCreateFeedbackInput(payload);
  if (!result.ok) {
    const body: ApiErrorResponse = {
      ok: false,
      error: 'Invalid feedback input',
      details: result.errors
    };
    return json(body, { status: 400 });
  }
  try {
    const feedback = await addFeedback(config.couch, result.value);
    const body: CreateFeedbackResponse = { feedback };
    return json(body, { status: 201 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      const body: ApiErrorResponse = { ok: false, error: err.message };
      return json(body, { status: 404 });
    }
    return couchUnreachable();
  }
};
