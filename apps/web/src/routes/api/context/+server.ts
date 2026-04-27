import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  type ApiErrorResponse,
  type ContextSummaryResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { buildRecentContext } from '$lib/server/context';

const DEFAULT_CONTEXT_LIMIT = 5;
const MAX_CONTEXT_LIMIT = 20;

function clampContextLimit(raw: string | null): number {
  if (!raw) return DEFAULT_CONTEXT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONTEXT_LIMIT;
  return Math.min(MAX_CONTEXT_LIMIT, n);
}

function couchUnreachable(): Response {
  const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
  return json(body, { status: 503 });
}

export const GET = async ({ url }: { url: URL }) => {
  const config = getServerConfig(env);
  const limit = clampContextLimit(url.searchParams.get('limit'));
  try {
    const context = await buildRecentContext(config.couch, limit);
    const body: ContextSummaryResponse = { context };
    return json(body);
  } catch {
    return couchUnreachable();
  }
};
