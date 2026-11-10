import type { RecipeCode, RecipeDoc } from '@brewdial/shared';
import type { ApiConfig } from './config.js';
import { listFeedbackForRecipe } from './repositories/feedback.js';
import { getBrew, listBrews, listXBloomRecipeLinks } from './repositories/brews.js';
import { getRecipeByCode, listRecipeChildren } from './repositories/recipes.js';
import { buildRecipeReview, RECIPE_REVIEW_LIMITS, type RecipeReviewNodeInput } from './recipe-review.js';

export function limitFetchConcurrency(baseFetch: typeof fetch, limit: number): typeof fetch {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await baseFetch(input, init);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

export async function fetchRecipeReview(config: ApiConfig, code: RecipeCode, fetchImpl?: typeof fetch) {
  const boundedConfig: ApiConfig = {
    ...config,
    fetchImpl: limitFetchConcurrency(fetchImpl ?? config.fetchImpl ?? fetch, RECIPE_REVIEW_LIMITS.maxConcurrentApiRequests),
  };
  const root = await getRecipeByCode(boundedConfig, code);
  if (!root) return null;

  const recipes = new Map<RecipeCode, RecipeDoc>([[root.code, root]]);
  let ancestorsTruncated = false;
  let parentCode = root.parentCode;
  while (parentCode && recipes.size <= RECIPE_REVIEW_LIMITS.ancestors) {
    if (recipes.has(parentCode)) break;
    const parent = await getRecipeByCode(boundedConfig, parentCode);
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
    const children = await listRecipeChildren(boundedConfig, current);
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

  const xbloomLinks = await listXBloomRecipeLinks(boundedConfig);
  const nodes: RecipeReviewNodeInput[] = await Promise.all([...recipes.values()].map(async (recipe) => {
    const [feedback, brews] = await Promise.all([
      listFeedbackForRecipe(boundedConfig, recipe.code),
      listBrews(boundedConfig, { recipeCode: recipe.code, limit: RECIPE_REVIEW_LIMITS.listBrews }),
    ]);
    const brewDetails = await Promise.all(brews.map((brew) => getBrew(boundedConfig, brew.xbloomBrewId)));
    return { recipe, feedback, brews, brewDetails: brewDetails.filter((brew) => brew !== null) };
  }));

  return buildRecipeReview({ code, nodes, xbloomLinks, ancestorsTruncated, descendantsTruncated });
}
