// Map backend API rows (snake_case, relational) to/from the @brewdial/shared
// document shapes (RecipeDoc / FeedbackDoc), so all shared logic — validation,
// context summaries, feedback rules — reuses unchanged. (Mirrors the mini-app's
// data/mappers.ts; MCP imports the shared package directly.)

import type {
  ActualBrewParams,
  BeanSnapshot,
  BrewMethod,
  DripperPortability,
  FeedbackDoc,
  FeedbackRatings,
  FeedbackSource,
  QuickFeedbackTag,
  RecipeCode,
  RecipeDoc,
  RecipeParams,
  RecipeStatus,
  RecipeStep,
} from '@brewdial/shared';

export interface RecipeRow {
  id: string;
  code: string;
  method: string;
  title: string;
  version: number;
  params: RecipeParams | null;
  steps: RecipeStep[] | null;
  bean_id: string | null;
  bean_snapshot: BeanSnapshot | null;
  intent: string[] | null;
  notes: string | null;
  adjustment_from_previous: string | null;
  created_by: string;
  owner_id?: string | null;
  is_official?: boolean;
  dripper_portability?: DripperPortability | null;
  status: string;
  supersedes: string | null;
  superseded_by: string | null;
  parent_code: string | null;
  created_at: string;
  updated_at: string;
}

export const RECIPE_COLUMNS =
  'id,code,method,title,version,params,steps,bean_id,bean_snapshot,intent,notes,adjustment_from_previous,created_by,owner_id,is_official,dripper_portability,status,supersedes,superseded_by,parent_code,created_at,updated_at';

export function rowToRecipe(r: RecipeRow): RecipeDoc {
  const doc: RecipeDoc = {
    _id: `recipe:${r.code}`,
    type: 'recipe',
    code: r.code as RecipeCode,
    method: r.method as BrewMethod,
    title: r.title,
    version: r.version,
    params: r.params ?? {},
    steps: r.steps ?? [],
    createdBy: r.created_by === 'agent' ? 'agent' : 'manual',
    status: (r.status as RecipeStatus) || 'active',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.supersedes != null) doc.supersedes = r.supersedes as RecipeCode;
  if (r.superseded_by != null) doc.supersededBy = r.superseded_by as RecipeCode;
  if (r.parent_code != null) doc.parentCode = r.parent_code as RecipeCode;
  if (r.bean_id != null) doc.beanId = r.bean_id;
  if (r.bean_snapshot != null) doc.beanSnapshot = r.bean_snapshot;
  if (r.intent != null) doc.intent = r.intent;
  if (r.notes != null) doc.notes = r.notes;
  if (r.adjustment_from_previous != null) doc.adjustmentFromPrevious = r.adjustment_from_previous;
  if (r.owner_id != null) doc.ownerId = r.owner_id;
  doc.isOfficial = r.is_official ?? false;
  if (r.dripper_portability != null) doc.dripperPortability = r.dripper_portability;
  return doc;
}

export interface FeedbackRow {
  id: string;
  recipe_code: string;
  bean_id: string | null;
  ratings: FeedbackRatings | null;
  actual: ActualBrewParams | null;
  comment: string | null;
  raw_comment: string | null;
  quick_tags: string[] | null;
  desired_direction: string[] | null;
  next_hint: string[] | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export const FEEDBACK_COLUMNS =
  'id,recipe_code,bean_id,ratings,actual,comment,raw_comment,quick_tags,desired_direction,next_hint,source,created_at,updated_at';

export function rowToFeedback(r: FeedbackRow): FeedbackDoc {
  const doc: FeedbackDoc = {
    _id: `feedback:${r.recipe_code}:${r.id}`,
    type: 'feedback',
    recipeCode: r.recipe_code as RecipeCode,
    recipeId: `recipe:${r.recipe_code}`,
    source: r.source as FeedbackSource,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.bean_id != null) doc.beanId = r.bean_id;
  if (r.ratings != null) doc.ratings = r.ratings;
  if (r.actual != null) doc.actual = r.actual;
  if (r.comment != null) doc.comment = r.comment;
  if (r.raw_comment != null) doc.rawComment = r.raw_comment;
  if (r.quick_tags != null) doc.quickTags = r.quick_tags as QuickFeedbackTag[];
  if (r.desired_direction != null) doc.desiredDirection = r.desired_direction;
  if (r.next_hint != null) doc.nextHint = r.next_hint;
  return doc;
}

