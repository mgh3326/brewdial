import type { PreferenceDoc } from '@brewdial/shared';
import type { SupabaseConfig } from '../config.js';
import { selectRows } from '../supabase.js';

interface PreferenceRow {
  id: string;
  likes: string[] | null;
  dislikes: string[] | null;
  default_params: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export async function getGlobalPreferences(
  config: SupabaseConfig,
  fetchImpl: typeof fetch = fetch
): Promise<PreferenceDoc | null> {
  const rows = await selectRows<PreferenceRow>(
    config,
    'preferences',
    'id=eq.global&select=id,likes,dislikes,default_params,created_at,updated_at&limit=1',
    fetchImpl
  );
  const r = rows[0];
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
