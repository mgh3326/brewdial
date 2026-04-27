import type {
  ActualBrewParams,
  BrewMethod,
  FeedbackDoc,
  FeedbackRatings,
  PreferenceDoc,
  RecipeDoc,
  RecipeParams,
  RecipeStep
} from './types.js';

export interface CreateRecipeInput {
  beanId?: string;
  beanSnapshot?: {
    name?: string;
    roaster?: string;
    roastDate?: string;
  };
  method: BrewMethod;
  title: string;
  params?: RecipeParams;
  steps?: RecipeStep[];
  intent?: string[];
  adjustmentFromPrevious?: string;
  createdBy?: 'agent' | 'manual';
}

export interface CreateRecipeResponse {
  recipe: RecipeDoc;
}

export interface ListRecipesResponse {
  recipes: RecipeDoc[];
}

export interface GetRecipeResponse {
  recipe: RecipeDoc;
}

export interface CreateFeedbackInput {
  recipeCode: `COF-${string}`;
  ratings: FeedbackRatings;
  actual?: ActualBrewParams;
  comment?: string;
  desiredDirection?: string[];
  nextHint?: string[];
  source?: 'web' | 'agent' | 'mcp';
}

export interface CreateFeedbackResponse {
  feedback: FeedbackDoc;
}

export interface ListFeedbackResponse {
  feedback: FeedbackDoc[];
}

export interface ApiErrorResponse {
  ok: false;
  error: string;
  details?: string[];
}

export interface FeedbackSummary {
  count: number;
  latestAt: string | null;
  averageOverall: number | null;
  commonDesiredDirections: string[];
  latestComment: string | null;
}

export interface RecipeWithFeedbackSummary {
  recipe: RecipeDoc;
  feedback: FeedbackDoc[];
  feedbackSummary: FeedbackSummary;
}

export interface ContextSummary {
  generatedAt: string;
  preferences: PreferenceDoc | null;
  recentRecipes: RecipeWithFeedbackSummary[];
  totals: {
    recipes: number;
    feedback: number;
  };
  guidance: string[];
}

export interface ContextSummaryResponse {
  context: ContextSummary;
}

export interface RecipeContext {
  generatedAt: string;
  preferences: PreferenceDoc | null;
  recipe: RecipeDoc;
  feedback: FeedbackDoc[];
  feedbackSummary: FeedbackSummary;
  guidance: string[];
}

export interface RecipeContextResponse {
  context: RecipeContext;
}
