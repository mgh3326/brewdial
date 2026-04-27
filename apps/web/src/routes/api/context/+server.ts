import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  type ApiErrorResponse,
  type ContextSummaryResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { buildRecentContext, parseContextLimit } from '$lib/server/context';

function couchUnreachable(): Response {
  const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
  return json(body, { status: 503 });
}

export const GET = async ({ url }: { url: URL }) => {
  const config = getServerConfig(env);
  const limit = parseContextLimit(url.searchParams.get('limit'));
  try {
    const context = await buildRecentContext(config.couch, limit);
    const body: ContextSummaryResponse = { context };
    return json(body);
  } catch {
    return couchUnreachable();
  }
};
