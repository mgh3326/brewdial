import type { RecipeCode, RecipeDoc } from '@brewdial/shared';
import type { ApiConfig } from './config.js';
import { listFeedbackForRecipe } from './repositories/feedback.js';
import { getBrew, listBrews, listXBloomRecipeLinks } from './repositories/brews.js';
import { getRecipeByCode, listRecipeChildren } from './repositories/recipes.js';
import { buildRecipeReview, RECIPE_REVIEW_LIMITS, type RecipeReviewNodeInput } from './recipe-review.js';

export async function fetchRecipeReview(config: ApiConfig, code: RecipeCode, fetchImpl?: typeof fetch) {
  const root = await getRecipeByCode(config, code, fetchImpl);
  if (!root) return null;

  const recipes = new Map<RecipeCode, RecipeDoc>([[root.code, root]]);
  let ancestorsTruncated = false;
  let parentCode = root.parentCode;
  while (parentCode && recipes.size <= RECIPE_REVIEW_LIMITS.ancestors) {
    if (recipes.has(parentCode)) break;
    const parent = await getRecipeByCode(config, parentCode, fetchImpl);
    if (!parent) break;
    recipes.set(parent.code, parent);
    parentCode = parent.parentCode;
  }
  if (parentCode && recipes.size > RECIPE_REVIEW_LIMITS.ancestors) ancestorsTruncated = true;

  const queue: RecipeCode[] = [root.code];
  const visited = new Set<RecipeCode>([root.code]);
  let descendantCount = 0;
  let descendantsTruncated = false;
  while (queue.length) {
    const current = queue.shift()!;
    const children = await listRecipeChildren(config, current, fetchImpl);
    for (const child of children) {
      if (visited.has(child.code)) continue;
      if (descendantCount >= RECIPE_REVIEW_LIMITS.descendants) {
        descendantsTruncated = true;
        continue;
      }
      visited.add(child.code);
      recipes.set(child.code, child);
      descendantCount += 1;
      queue.push(child.code);
    }
  }

  const xbloomLinks = await listXBloomRecipeLinks(config, fetchImpl);
  const nodes: RecipeReviewNodeInput[] = await Promise.all([...recipes.values()].map(async (recipe) => {
    const [feedback, brews] = await Promise.all([
      listFeedbackForRecipe(config, recipe.code, fetchImpl),
      listBrews(config, { recipeCode: recipe.code, limit: RECIPE_REVIEW_LIMITS.listBrews }, fetchImpl),
    ]);
    const brewDetails = await Promise.all(brews.map((brew) => getBrew(config, brew.xbloomBrewId, fetchImpl)));
    return { recipe, feedback, brews, brewDetails: brewDetails.filter((brew) => brew !== null) };
  }));

  return buildRecipeReview({ code, nodes, xbloomLinks, ancestorsTruncated, descendantsTruncated });
}
