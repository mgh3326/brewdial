// Identity-scoped content wrappers. All reads/writes of per-user data go through
// the backend API with the X-BrewDial-Identity header (provider:externalKey).
// The backend resolves the app_user_id from the header — clients never pass it.

import { resolveIdentity } from '../identity';
import { apiGet, apiSend } from '../api';
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
  const identity = await resolveIdentity();
  await apiSend('POST', '/me/saved-recipes', { code, note: note ?? null }, { identity });
}

// Bookmark a bean ("내 원두 선반").
export async function saveBean(beanId: string): Promise<void> {
  const identity = await resolveIdentity();
  await apiSend('POST', '/me/saved-beans', { beanId }, { identity });
}

// The current user's saved recipes/beans, gear, calibration, and owned recipe codes.
export async function getMyCollections(): Promise<MyCollections> {
  const identity = await resolveIdentity();
  const d = await apiGet<Partial<MyCollections>>('/me/collections', { identity });
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
  const identity = await resolveIdentity();
  const data = await apiSend<{ ok: boolean; id: string | null }>('PUT', '/me/gear', gear, { identity });
  return data?.id ?? null;
}

export interface CalibrationInput {
  fromLabel: string;
  toLabel: string;
  anchorMethod?: string;
  fromGrinderId?: string;
  toGrinderId?: string;
  samples: { fromClicks: number; toClicks: number }[];
  source?: 'measured' | 'dial-in-start';
  notes?: string;
}

// ROB-611 (D): save a per-user grinder-pair calibration (one-time offset).
export async function upsertCalibration(cal: CalibrationInput): Promise<string | null> {
  const identity = await resolveIdentity();
  const data = await apiSend<{ ok: boolean; id: string | null }>('PUT', '/me/calibration', cal, { identity });
  return data?.id ?? null;
}
