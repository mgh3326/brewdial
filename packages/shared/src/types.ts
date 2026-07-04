export type BrewMethod = 'v60' | 'espresso' | 'aeropress' | 'kalita' | 'other';

export type RecipeCode = `COF-${string}`;

// ROB-609: lineage + lifecycle status so re-saves vs intended variants are
// structurally distinguishable (not just free-text).
export type RecipeStatus = 'active' | 'superseded' | 'archived' | 'test';

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

// ── ROB-654: structured bean attributes (agent-written; DB stores inputs only,
// the taste profile / ranking / match reasons are computed at read time).
// flavorCategories = SCA flavor wheel inner ring (9). LLM single-rubric scoring is
// canonical for the 1..5 axes; roaster's own numbers live in attrsNotes as evidence.
export const BEAN_FLAVOR_CATEGORIES = [
  'fruity',
  'floral',
  'sweet',
  'nutty_cocoa',
  'spices',
  'roasted',
  'cereal',
  'sour_fermented',
  'green'
] as const;
export type BeanFlavorCategory = (typeof BEAN_FLAVOR_CATEGORIES)[number];

export const BEAN_ATTRS_SOURCES = ['roaster_page', 'ai_extracted', 'manual'] as const;
export type BeanAttrsSource = (typeof BEAN_ATTRS_SOURCES)[number];

export interface BeanAttributes {
  roastLevelOrd?: number; // 1 (light) .. 5 (dark)
  agtronMin?: number;
  agtronMax?: number;
  acidity?: number; // 1 (low) .. 5 (high)
  body?: number; // 1 (light) .. 5 (heavy)
  decaf?: boolean;
  flavorCategories?: BeanFlavorCategory[];
  attrsSource?: BeanAttrsSource;
  sourceUrl?: string;
  attrsNotes?: string; // original roaster notation, verbatim (drift detection)
}

// ── ROB-611: grinder-portable grind. params.grind is string (legacy free text)
// | GrindSpec (structured). Absolute clicks/microns are unreliable across grinders;
// the robust anchors are brew-method position + target drawdown time.
export type GrindSource = 'measured' | 'dial-in-start';
export interface GrindTarget {
  microns?: number; // SECONDARY/advisory only (absolute unreliable)
  brewMethodPosition?: string; // PRIMARY anchor #1, e.g. "v60 medium-fine"
  targetDrawdownSec?: number; // PRIMARY anchor #2 (robust cross-grinder invariant)
}
export interface PerGrinderGrind {
  grinder: string; // free text OR grinders.name
  grinderId?: string; // optional FK into grinders registry
  clicks: number | string; // string supports stepless(무단), e.g. "1.5 rev"
  stepless?: boolean;
  source: GrindSource; // 'measured' = trusted; 'dial-in-start' = show disclaimer
}
export interface GrindSpec {
  target: GrindTarget; // REQUIRED; must carry >=1 of brewMethodPosition|targetDrawdownSec
  perGrinder?: PerGrinderGrind[];
  legacyText?: string; // original free text, preserved verbatim
}
export type GrindField = string | GrindSpec;

export interface RecipeParams {
  doseG?: number;
  waterG?: number;
  ratio?: string;
  tempC?: number;
  grind?: GrindField; // ROB-611: was string; now string | GrindSpec (legacy-compatible)
  grinder?: string;
  brewer?: string;
  targetTimeSec?: number;
}

// ── ROB-611 backward-compat read accessors (every grind reader must use these).
export function readGrind(g: GrindField | undefined): GrindSpec {
  if (g == null) return { target: {} };
  if (typeof g === 'string') return { target: {}, legacyText: g };
  return g;
}
export function grindDisplay(g: GrindField | undefined): string {
  if (g == null) return '';
  if (typeof g === 'string') return g;
  return (
    g.legacyText ??
    (g.perGrinder?.[0] ? `${g.perGrinder[0].grinder} ${g.perGrinder[0].clicks}` : undefined) ??
    g.target.brewMethodPosition ??
    ''
  );
}

export interface RecipeStep {
  atSec?: number;
  endSec?: number;
  waterG?: number;
  pourRateGPerSec?: number;
  note: string;
}

// ── ROB-612: dripper-portable layer (own recipes.dripper_portability column).
// No single scalar invariant; class-based start point + dial-in. Anchors (ratio,
// temp, target time) are fixed across drippers. Absent on legacy V60-only recipes.
export type DripperClass = 'bed_restricted' | 'dripper_restricted' | 'hybrid' | 'immersion';
export type GrindShift = 'coarser' | 'finer' | 'none';
export type PourShift = 'gentler' | 'more_agitation' | 'fewer_pours' | 'more_pours' | 'none';
export type Confidence = 'high' | 'medium' | 'low';
export interface DripperTarget {
  dripper: string;
  dripperId?: string;
  class: DripperClass;
  sizeMatch: 'ok' | 'undersized' | 'oversized';
  bedDepthShift?: 'shallower' | 'deeper' | 'similar';
  bedOverflow?: boolean;
  grindShift: GrindShift;
  pourShift: PourShift;
  confidence: Confidence;
  warn?: string;
  note?: string;
}
export interface DripperPortability {
  origin: { dripper: string; dripperId?: string; sizeModel?: string };
  anchors: { ratio?: string; tempC?: number; targetDrawdownSec?: number };
  classNote?: string;
  targets?: DripperTarget[];
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
  // Phase 0 identity/ownership (independent axes): ownerId NULL/absent = anonymous
  // public UGC; isOfficial = operator/agent-curated badge (real column, default false).
  ownerId?: string;
  isOfficial?: boolean;
  dripperPortability?: DripperPortability; // ROB-612 dripper-portable layer
  status?: RecipeStatus;
  supersedes?: RecipeCode;
  supersededBy?: RecipeCode;
  parentCode?: RecipeCode;
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

export const QUICK_FEEDBACK_TAGS = [
  '고소함',
  '견과류',
  '쓴맛',
  '산미',
  '떫음',
  '묽음',
  '진함',
  '좋았음',
  '아쉬움'
] as const;
export type QuickFeedbackTag = (typeof QUICK_FEEDBACK_TAGS)[number];

export type FeedbackSource = 'web' | 'coffee_profile' | 'api' | 'agent' | 'mcp';

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
  ratings?: FeedbackRatings;
  actual?: ActualBrewParams;
  comment?: string;
  rawComment?: string;
  quickTags?: QuickFeedbackTag[];
  desiredDirection?: string[];
  nextHint?: string[];
  source: FeedbackSource;
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

// ── ROB-654 v2 S1: 정규 취향 태그(교정 UI 화이트리스트).
export const TASTE_TAGS = [
  '저산미',
  '고산미',
  '다크 로스팅',
  '라이트 로스팅',
  '고소함',
  '초콜릿/단맛',
  '저녁은 디카페인'
] as const;
export type TasteTag = (typeof TASTE_TAGS)[number];
