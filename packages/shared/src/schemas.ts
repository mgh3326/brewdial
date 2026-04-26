export const recipeCodePattern = /^COF-\d{4,}$/;

export function isRecipeCode(value: string): value is `COF-${string}` {
  return recipeCodePattern.test(value);
}
