import type { PreferenceDoc } from '@brewdial/shared';
import type { ApiConfig } from '../config.js';
import { ApiError, getJson, postJson } from '../api.js';

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

export async function updateGlobalPreferences(
  config: ApiConfig,
  input: { likes: string[]; dislikes: string[] },
  fetchImpl: typeof fetch = fetch
): Promise<PreferenceDoc> {
  // POST /api/agent/preferences/global is the agent-only global write path.
  const row = await postJson<PreferenceRow>(config, '/api/agent/preferences/global', input, fetchImpl);
  return {
    _id: 'preference:global',
    type: 'preference',
    likes: row.likes ?? [],
    dislikes: row.dislikes ?? [],
    defaultParams: row.default_params ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
