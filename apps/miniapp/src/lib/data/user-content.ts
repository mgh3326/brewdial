// Phase 1 RPC wrappers for per-user content. All reads/writes of identity-scoped
// data go through the SECURITY DEFINER RPCs (the tables are deny-all to anon): the
// client never passes app_user_id/owner_id — only (provider, externalKey), which
// the server resolves. See supabase/schema.sql (resolve_app_user + rpc_*).

import { supabase } from '../supabase';
import { resolveIdentity } from '../identity';
import type { RecipeCode } from '../domain';

export interface MyCollections {
  savedRecipes: unknown[];
  savedBeans: unknown[];
  gear: unknown[];
  calibration: unknown[];
  myRecipes: string[];
}

export interface GearInput {
  kind: 'grinder' | 'dripper';
  label: string;
  grinderId?: string;
  dripperId?: string;
  details?: Record<string, unknown>;
  isDefault?: boolean;
}

// Bookmark a recipe ("저장"). Snapshot is built server-side (offline-by-construction).
export async function saveRecipe(code: RecipeCode | string, note?: string): Promise<void> {
  const { provider, externalKey } = await resolveIdentity();
  const { error } = await supabase.rpc('rpc_save_recipe', {
    p_provider: provider,
    p_external_key: externalKey,
    p_code: code,
    p_note: note ?? null,
  });
  if (error) throw error;
}

// Bookmark a bean ("내 원두 선반").
export async function saveBean(beanId: string): Promise<void> {
  const { provider, externalKey } = await resolveIdentity();
  const { error } = await supabase.rpc('rpc_save_bean', {
    p_provider: provider,
    p_external_key: externalKey,
    p_bean_id: beanId,
  });
  if (error) throw error;
}

// The current user's saved recipes/beans, gear, calibration, and owned recipe codes.
export async function getMyCollections(): Promise<MyCollections> {
  const { provider, externalKey } = await resolveIdentity();
  const { data, error } = await supabase.rpc('rpc_my_collections', {
    p_provider: provider,
    p_external_key: externalKey,
  });
  if (error) throw error;
  const d = (data ?? {}) as Partial<MyCollections>;
  return {
    savedRecipes: d.savedRecipes ?? [],
    savedBeans: d.savedBeans ?? [],
    gear: d.gear ?? [],
    calibration: d.calibration ?? [],
    myRecipes: d.myRecipes ?? [],
  };
}

// Upsert a piece of the user's gear (grinder/dripper).
export async function upsertGear(gear: GearInput): Promise<string | null> {
  const { provider, externalKey } = await resolveIdentity();
  const { data, error } = await supabase.rpc('rpc_upsert_gear', {
    p_provider: provider,
    p_external_key: externalKey,
    p_gear: gear,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

// Create an OWNED recipe ("save as mine"). Server stamps owner_id, forces
// created_by='manual'/status='active'. Payload keys are camelCase (the SQL reads
// method,title,params,steps,beanSnapshot,intent,notes,adjustmentFromPrevious,dripperPortability).
// Returns the new COF code.
export async function createOwnedRecipe(recipe: Record<string, unknown>): Promise<string | null> {
  const { provider, externalKey } = await resolveIdentity();
  const { data, error } = await supabase.rpc('rpc_create_owned_recipe', {
    p_provider: provider,
    p_external_key: externalKey,
    p_recipe: recipe,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}
