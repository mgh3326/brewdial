import type {
  ActualBrewParams,
  BrewMethod,
  FeedbackDoc,
  FeedbackRatings,
  RecipeDoc,
  RecipeParams,
  RecipeStep
} from './types';

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
