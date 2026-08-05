import type { RecipeCode } from './domain';

export type TabKey = 'home' | 'saved';

// Routes that show the floating tab bar get a tab key; detail/form/404 → null.
// ROB-633: '/recipes' is the legacy alias of the bean-centric home.
export function whichTab(path: string): TabKey | null {
  if (path === '/' || path === '/recipes' || path === '/recipes/') return 'home';
  if (path === '/saved') return 'saved';
  return null;
}

// Coerce a backend string into a RecipeCode only when it matches the COF- shape,
// so the collections' `string[]`/`recipe_code` fields can flow into getRecipeByCode
// without an unchecked cast.
export function asRecipeCode(code: string): RecipeCode | null {
  return code.startsWith('COF-') ? (code as RecipeCode) : null;
}
