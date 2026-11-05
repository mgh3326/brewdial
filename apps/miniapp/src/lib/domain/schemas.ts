// GENERATED from packages/shared/src/schemas.ts by scripts/sync-miniapp-domain.mjs.
// Do not edit: change packages/shared and run `pnpm domain:sync`.
import type { PreferenceDoc } from './types.js';

export const recipeCodePattern = /^COF-\d{4,}$/;

export function isRecipeCode(value: string): value is `COF-${string}` {
  return recipeCodePattern.test(value);
}

export function createDefaultPreferenceDoc(now: string = new Date().toISOString()): PreferenceDoc {
  return {
    _id: 'preference:global',
    type: 'preference',
    likes: [],
    dislikes: [],
    defaultParams: {},
    createdAt: now,
    updatedAt: now
  };
}
