import type { PreferenceDoc } from '@brewdial/shared';
import type { ApiConfig } from '../config.js';
import { getJson } from '../api.js';
import { ApiError } from '../api.js';

interface PreferenceRow {
  id: string;
  likes: string[] | null;
  dislikes: string[] | null;
  default_params: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export async function getGlobalPreferences(
  config: ApiConfig,
  fetchImpl: typeof fetch = fetch
): Promise<PreferenceDoc | null> {
  // GET /api/agent/preferences/global — returns the singleton row or null.
  let r: PreferenceRow | null;
  try {
    r = await getJson<PreferenceRow | null>(config, '/api/agent/preferences/global', '', fetchImpl);
  } catch (err: unknown) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
  if (!r) return null;
  return {
    _id: 'preference:global',
    type: 'preference',
    likes: r.likes ?? [],
    dislikes: r.dislikes ?? [],
    defaultParams: r.default_params ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
