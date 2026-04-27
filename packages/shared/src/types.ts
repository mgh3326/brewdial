export type BrewMethod = 'v60' | 'espresso' | 'aeropress' | 'kalita' | 'other';

export type RecipeCode = `COF-${string}`;

export type RatingValue = 0 | 1 | 2 | 3 | 4;

export type OverallRating = 1 | 2 | 3 | 4 | 5;

export interface BeanSnapshot {
  name?: string;
  roaster?: string;
  roastDate?: string;
  roastLevel?: string;
  origin?: string;
  process?: string;
  notes?: string;
}

export interface RecipeParams {
  doseG?: number;
  waterG?: number;
  ratio?: string;
  tempC?: number;
  grind?: string;
  grinder?: string;
  brewer?: string;
  targetTimeSec?: number;
}

export interface RecipeStep {
  atSec?: number;
  waterG?: number;
  note: string;
}

export interface RecipeDoc {
  _id: string;
  _rev?: string;
  type: 'recipe';
  code: RecipeCode;
  beanId?: string;
  beanSnapshot?: BeanSnapshot;
  method: BrewMethod;
  version: number;
  title: string;
  params: RecipeParams;
  steps: RecipeStep[];
  intent?: string[];
  notes?: string;
  adjustmentFromPrevious?: string;
  createdBy: 'agent' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackRatings {
  overall?: OverallRating;
  burnt?: RatingValue;
  bitter?: RatingValue;
  sour?: RatingValue;
  sweetness?: RatingValue;
  body?: RatingValue;
  astringency?: RatingValue;
  clarity?: RatingValue;
}

export interface ActualBrewParams {
  tempC?: number;
  grind?: string;
  timeSec?: number;
}

export interface FeedbackDoc {
  _id: string;
  _rev?: string;
  type: 'feedback';
  recipeCode: RecipeCode;
  recipeId: string;
  beanId?: string;
  ratings: FeedbackRatings;
  actual?: ActualBrewParams;
  comment?: string;
  desiredDirection?: string[];
  nextHint?: string[];
  source: 'web' | 'agent' | 'mcp';
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceDoc {
  _id: 'preference:global';
  _rev?: string;
  type: 'preference';
  likes: string[];
  dislikes: string[];
  defaultParams?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CounterDoc {
  _id: `counter:${string}`;
  _rev?: string;
  type: 'counter';
  next: number;
  createdAt: string;
  updatedAt: string;
}

export type BrewDialDoc = RecipeDoc | FeedbackDoc | PreferenceDoc | CounterDoc;
