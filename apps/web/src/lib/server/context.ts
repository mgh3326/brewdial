import type {
  ContextSummary,
  FeedbackDoc,
  FeedbackSummary,
  PreferenceDoc,
  RecipeCode,
  RecipeContext,
  RecipeDoc,
  RecipeWithFeedbackSummary
} from '@brewdial/shared';
import type { CouchConfig } from './config';
import { getRecipeByCode, listRecentRecipes } from './repositories/recipes';
import { listFeedbackForRecipe } from './repositories/feedback';
import { getGlobalPreferences } from './repositories/preferences';

export interface ContextGuidanceInput {
  preferences: PreferenceDoc | null;
  recipes: RecipeWithFeedbackSummary[];
}

export interface RecipeGuidanceInput {
  preferences: PreferenceDoc | null;
  recipe: RecipeDoc;
  feedbackSummary: FeedbackSummary;
}

export function summarizeFeedback(feedback: FeedbackDoc[]): FeedbackSummary {
  if (feedback.length === 0) {
    return {
      count: 0,
      latestAt: null,
      averageOverall: null,
      commonDesiredDirections: [],
      latestComment: null
    };
  }

  let latestAt: string | null = null;
  for (const f of feedback) {
    if (latestAt === null || f.createdAt > latestAt) {
      latestAt = f.createdAt;
    }
  }

  const overalls: number[] = [];
  for (const f of feedback) {
    if (typeof f.ratings.overall === 'number') overalls.push(f.ratings.overall);
  }
  const averageOverall =
    overalls.length === 0
      ? null
      : Math.round(
          (overalls.reduce((a, b) => a + b, 0) / overalls.length) * 100
        ) / 100;

  const directionOrder = new Map<string, { count: number; firstIndex: number }>();
  let nextIndex = 0;
  for (const f of feedback) {
    for (const raw of f.desiredDirection ?? []) {
      const key = raw.trim();
      if (!key) continue;
      const entry = directionOrder.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        directionOrder.set(key, { count: 1, firstIndex: nextIndex });
        nextIndex += 1;
      }
    }
  }
  const commonDesiredDirections = [...directionOrder.entries()]
    .sort(
      (a, b) => b[1].count - a[1].count || a[1].firstIndex - b[1].firstIndex
    )
    .map(([key]) => key);

  let latestCommentDoc: FeedbackDoc | null = null;
  for (const f of feedback) {
    const trimmed = f.comment?.trim();
    if (!trimmed) continue;
    if (
      latestCommentDoc === null ||
      f.createdAt > latestCommentDoc.createdAt
    ) {
      latestCommentDoc = f;
    }
  }
  const latestComment = latestCommentDoc?.comment ?? null;

  return {
    count: feedback.length,
    latestAt,
    averageOverall,
    commonDesiredDirections,
    latestComment
  };
}

function preferenceLine(prefs: PreferenceDoc | null): string | null {
  if (!prefs) return null;
  const likes = prefs.likes.filter((s) => s.trim().length > 0);
  const dislikes = prefs.dislikes.filter((s) => s.trim().length > 0);
  if (likes.length === 0 && dislikes.length === 0) return null;
  const parts: string[] = [];
  if (likes.length > 0) parts.push(`likes [${likes.join(', ')}]`);
  if (dislikes.length > 0) parts.push(`dislikes [${dislikes.join(', ')}]`);
  return `Preferences: ${parts.join('; ')}.`;
}

export function buildContextGuidance(input: ContextGuidanceInput): string[] {
  const out: string[] = [];
  if (input.recipes.length === 0) {
    out.push(
      'No recipes yet. Create a baseline recipe before asking for dial-in suggestions.'
    );
  } else {
    const newest = input.recipes[0];
    const s = newest.feedbackSummary;
    if (s.count === 0) {
      out.push(
        `Recent recipe ${newest.recipe.code} has no feedback yet; collect tasting notes before changing parameters.`
      );
    } else if (typeof s.averageOverall === 'number' && s.averageOverall < 3) {
      out.push(
        `${newest.recipe.code} average overall is below 3; inspect feedback comments and desired directions before repeating.`
      );
    }
  }
  const pref = preferenceLine(input.preferences);
  if (pref) out.push(pref);
  return out;
}

export function buildRecipeGuidance(input: RecipeGuidanceInput): string[] {
  const out: string[] = [];
  if (input.feedbackSummary.count === 0) {
    out.push(
      `Recipe ${input.recipe.code} has no feedback yet; collect tasting notes before changing parameters.`
    );
  } else if (
    typeof input.feedbackSummary.averageOverall === 'number' &&
    input.feedbackSummary.averageOverall < 3
  ) {
    out.push(
      `${input.recipe.code} average overall is below 3; inspect feedback comments and desired directions before repeating.`
    );
  }
  const pref = preferenceLine(input.preferences);
  if (pref) out.push(pref);
  return out;
}

const DEFAULT_CONTEXT_LIMIT = 5;
const MIN_CONTEXT_LIMIT = 1;
const MAX_CONTEXT_LIMIT = 20;

function clampContextLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_CONTEXT_LIMIT;
  const n = Math.floor(raw);
  if (n < MIN_CONTEXT_LIMIT) return MIN_CONTEXT_LIMIT;
  if (n > MAX_CONTEXT_LIMIT) return MAX_CONTEXT_LIMIT;
  return n;
}

export async function buildRecentContext(
  config: CouchConfig,
  limit?: number,
  fetchImpl?: typeof fetch
): Promise<ContextSummary> {
  const safeLimit = clampContextLimit(limit);
  const [recentRecipes, preferences] = await Promise.all([
    listRecentRecipes(config, safeLimit, fetchImpl),
    getGlobalPreferences(config, fetchImpl)
  ]);
  const enriched: RecipeWithFeedbackSummary[] = await Promise.all(
    recentRecipes.map(async (recipe) => {
      const feedback = await listFeedbackForRecipe(config, recipe.code, fetchImpl);
      return {
        recipe,
        feedback,
        feedbackSummary: summarizeFeedback(feedback)
      };
    })
  );
  const totals = {
    recipes: enriched.length,
    feedback: enriched.reduce((acc, r) => acc + r.feedback.length, 0)
  };
  const guidance = buildContextGuidance({ preferences, recipes: enriched });
  return {
    generatedAt: new Date().toISOString(),
    preferences,
    recentRecipes: enriched,
    totals,
    guidance
  };
}

export async function buildRecipeContext(
  config: CouchConfig,
  code: RecipeCode,
  fetchImpl?: typeof fetch
): Promise<RecipeContext | null> {
  const recipe = await getRecipeByCode(config, code, fetchImpl);
  if (!recipe) return null;
  const [feedback, preferences] = await Promise.all([
    listFeedbackForRecipe(config, code, fetchImpl),
    getGlobalPreferences(config, fetchImpl)
  ]);
  const feedbackSummary = summarizeFeedback(feedback);
  const guidance = buildRecipeGuidance({ preferences, recipe, feedbackSummary });
  return {
    generatedAt: new Date().toISOString(),
    preferences,
    recipe,
    feedback,
    feedbackSummary,
    guidance
  };
}
