import type { RecipeCode } from './domain';

export type TabKey = 'pick' | 'beans' | 'saved';

// Routes that show the floating tab bar get a tab key; detail/form/404 → null.
// '/recipes' remains the legacy alias of the bean-centric list.
export function whichTab(path: string): TabKey | null {
  if (path === '/') return 'pick';
  if (path === '/beans' || path === '/recipes' || path === '/recipes/') return 'beans';
  if (path === '/saved') return 'saved';
  return null;
}

// Coerce a backend string into a RecipeCode only when it matches the COF- shape,
// so the collections' `string[]`/`recipe_code` fields can flow into getRecipeByCode
// without an unchecked cast.
export function asRecipeCode(code: string): RecipeCode | null {
  return code.startsWith('COF-') ? (code as RecipeCode) : null;
}
