import type { PreferenceDoc } from '../domain';
import { supabase } from '../supabase';
import { dbError } from '../labels';

export async function getGlobalPreference(): Promise<PreferenceDoc | null> {
  const { data, error } = await supabase
    .from('preferences')
    .select('id,likes,dislikes,default_params,created_at,updated_at')
    .eq('id', 'global')
    .maybeSingle();
  if (error) throw dbError('getGlobalPreference', error.message);
  if (!data) return null;
  return {
    _id: 'preference:global',
    type: 'preference',
    likes: data.likes ?? [],
    dislikes: data.dislikes ?? [],
    defaultParams: data.default_params ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
