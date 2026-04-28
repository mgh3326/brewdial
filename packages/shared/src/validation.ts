import type { CreateFeedbackInput, CreateRecipeInput } from './api-types.js';
import { isRecipeCode } from './schemas.js';
import type {
  ActualBrewParams,
  BrewMethod,
  FeedbackRatings,
  FeedbackSource,
  QuickFeedbackTag,
  RecipeParams,
  RecipeStep
} from './types.js';
import { QUICK_FEEDBACK_TAGS } from './types.js';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const BREW_METHODS: readonly BrewMethod[] = [
  'v60',
  'espresso',
  'aeropress',
  'kalita',
  'other'
];

const FEEDBACK_SOURCES = ['web', 'coffee_profile', 'api', 'agent', 'mcp'] as const;
const CREATED_BY_VALUES = ['agent', 'manual'] as const;

const RECIPE_PARAM_NUMBER_KEYS = ['doseG', 'waterG', 'tempC', 'targetTimeSec'] as const;
const RECIPE_PARAM_STRING_KEYS = ['ratio', 'grind', 'grinder', 'brewer'] as const;

const SENSORY_RATING_KEYS = [
  'burnt',
  'bitter',
  'sour',
  'sweetness',
  'body',
  'astringency',
  'clarity'
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function pickString(
  source: Record<string, unknown>,
  key: string,
  errors: string[],
  path: string
): string | undefined {
  const v = source[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') {
    errors.push(`${path}.${key} must be a string`);
    return undefined;
  }
  return v;
}

function validateBeanSnapshot(
  raw: unknown,
  errors: string[]
): CreateRecipeInput['beanSnapshot'] | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    errors.push('beanSnapshot must be an object');
    return undefined;
  }
  const out: NonNullable<CreateRecipeInput['beanSnapshot']> = {};
  const name = pickString(raw, 'name', errors, 'beanSnapshot');
  const roaster = pickString(raw, 'roaster', errors, 'beanSnapshot');
  const roastDate = pickString(raw, 'roastDate', errors, 'beanSnapshot');
  const roastLevel = pickString(raw, 'roastLevel', errors, 'beanSnapshot');
  const origin = pickString(raw, 'origin', errors, 'beanSnapshot');
  const process = pickString(raw, 'process', errors, 'beanSnapshot');
  const notes = pickString(raw, 'notes', errors, 'beanSnapshot');
  if (name !== undefined) out.name = name;
  if (roaster !== undefined) out.roaster = roaster;
  if (roastDate !== undefined) out.roastDate = roastDate;
  if (roastLevel !== undefined) out.roastLevel = roastLevel;
  if (origin !== undefined) out.origin = origin;
  if (process !== undefined) out.process = process;
  if (notes !== undefined) out.notes = notes;
  return out;
}

function validateRecipeParams(
  raw: unknown,
  errors: string[]
): RecipeParams | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    errors.push('params must be an object');
    return undefined;
  }
  const out: RecipeParams = {};
  for (const key of RECIPE_PARAM_NUMBER_KEYS) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || Number.isNaN(v)) {
      errors.push(`params.${key} must be a number`);
      continue;
    }
    out[key] = v;
  }
  for (const key of RECIPE_PARAM_STRING_KEYS) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== 'string') {
      errors.push(`params.${key} must be a string`);
      continue;
    }
    out[key] = v;
  }
  return out;
}

function validateRecipeSteps(
  raw: unknown,
  errors: string[]
): RecipeStep[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push('steps must be an array');
    return undefined;
  }
  const out: RecipeStep[] = [];
  raw.forEach((step, i) => {
    if (!isPlainObject(step)) {
      errors.push(`steps[${i}] must be an object`);
      return;
    }
    const note = step.note;
    if (typeof note !== 'string' || note.trim().length === 0) {
      errors.push(`steps[${i}].note must be a non-empty string`);
      return;
    }
    const built: RecipeStep = { note };
    if (step.atSec !== undefined) {
      if (typeof step.atSec !== 'number') {
        errors.push(`steps[${i}].atSec must be a number`);
      } else {
        built.atSec = step.atSec;
      }
    }
    if (step.waterG !== undefined) {
      if (typeof step.waterG !== 'number') {
        errors.push(`steps[${i}].waterG must be a number`);
      } else {
        built.waterG = step.waterG;
      }
    }
    out.push(built);
  });
  return out;
}

export function validateCreateRecipeInput(
  input: unknown
): ValidationResult<CreateRecipeInput> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['input must be an object'] };
  }

  const method = input.method;
  if (typeof method !== 'string' || !BREW_METHODS.includes(method as BrewMethod)) {
    errors.push(`method must be one of ${BREW_METHODS.join(', ')}`);
  }

  if (!isNonEmptyString(input.title)) {
    errors.push('title is required and must be a non-empty string');
  }

  const beanId = pickString(input, 'beanId', errors, 'input');
  const beanSnapshot = validateBeanSnapshot(input.beanSnapshot, errors);
  const params = validateRecipeParams(input.params, errors);
  const steps = validateRecipeSteps(input.steps, errors);

  let intent: string[] | undefined;
  if (input.intent !== undefined) {
    if (!isStringArray(input.intent)) errors.push('intent must be a string array');
    else intent = input.intent;
  }

  const notes = pickString(input, 'notes', errors, 'input');

  const adjustmentFromPrevious = pickString(
    input,
    'adjustmentFromPrevious',
    errors,
    'input'
  );

  let createdBy: 'agent' | 'manual' | undefined;
  if (input.createdBy !== undefined) {
    if (
      typeof input.createdBy !== 'string' ||
      !CREATED_BY_VALUES.includes(input.createdBy as 'agent' | 'manual')
    ) {
      errors.push(`createdBy must be one of ${CREATED_BY_VALUES.join(', ')}`);
    } else {
      createdBy = input.createdBy as 'agent' | 'manual';
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: CreateRecipeInput = {
    method: method as BrewMethod,
    title: (input.title as string).trim()
  };
  if (beanId !== undefined) value.beanId = beanId;
  if (beanSnapshot !== undefined) value.beanSnapshot = beanSnapshot;
  if (params !== undefined) value.params = params;
  if (steps !== undefined) value.steps = steps;
  if (intent !== undefined) value.intent = intent;
  if (notes !== undefined) value.notes = notes;
  if (adjustmentFromPrevious !== undefined) value.adjustmentFromPrevious = adjustmentFromPrevious;
  if (createdBy !== undefined) value.createdBy = createdBy;

  return { ok: true, value };
}

function validateRatings(
  raw: unknown,
  errors: string[]
): FeedbackRatings | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    errors.push('ratings must be an object');
    return undefined;
  }
  const out: FeedbackRatings = {};
  if (raw.overall !== undefined) {
    if (!isInt(raw.overall) || raw.overall < 1 || raw.overall > 5) {
      errors.push('ratings.overall must be an integer 1-5');
    } else {
      out.overall = raw.overall as FeedbackRatings['overall'];
    }
  }
  for (const key of SENSORY_RATING_KEYS) {
    const v = raw[key];
    if (v === undefined) continue;
    if (!isInt(v) || v < 0 || v > 4) {
      errors.push(`ratings.${key} must be an integer 0-4`);
      continue;
    }
    out[key] = v as FeedbackRatings[typeof key];
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function validateActual(
  raw: unknown,
  errors: string[]
): ActualBrewParams | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    errors.push('actual must be an object');
    return undefined;
  }
  const out: ActualBrewParams = {};
  if (raw.tempC !== undefined) {
    if (typeof raw.tempC !== 'number') errors.push('actual.tempC must be a number');
    else out.tempC = raw.tempC;
  }
  if (raw.grind !== undefined) {
    if (typeof raw.grind !== 'string') errors.push('actual.grind must be a string');
    else out.grind = raw.grind;
  }
  if (raw.timeSec !== undefined) {
    if (typeof raw.timeSec !== 'number') errors.push('actual.timeSec must be a number');
    else out.timeSec = raw.timeSec;
  }
  return out;
}

export function validateCreateFeedbackInput(
  input: unknown
): ValidationResult<CreateFeedbackInput> {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['input must be an object'] };
  }

  const recipeCode = input.recipeCode;
  if (typeof recipeCode !== 'string' || !isRecipeCode(recipeCode)) {
    errors.push('recipeCode must match COF-NNNN');
  }

  const ratings = validateRatings(input.ratings, errors);
  const actual = validateActual(input.actual, errors);

  const rawComment = pickString(input, 'rawComment', errors, 'input');
  const comment = pickString(input, 'comment', errors, 'input');

  let quickTags: QuickFeedbackTag[] | undefined;
  if (input.quickTags !== undefined) {
    if (!isStringArray(input.quickTags)) {
      errors.push('quickTags must be a string array');
    } else {
      const allowed = new Set<string>(QUICK_FEEDBACK_TAGS);
      const invalid = input.quickTags.filter((t) => !allowed.has(t));
      if (invalid.length > 0) {
        errors.push(`quickTags contains unknown values: ${invalid.join(', ')}`);
      } else if (input.quickTags.length > 0) {
        quickTags = input.quickTags as QuickFeedbackTag[];
      }
    }
  }

  let desiredDirection: string[] | undefined;
  if (input.desiredDirection !== undefined) {
    if (!isStringArray(input.desiredDirection))
      errors.push('desiredDirection must be a string array');
    else desiredDirection = input.desiredDirection;
  }

  let nextHint: string[] | undefined;
  if (input.nextHint !== undefined) {
    if (!isStringArray(input.nextHint)) errors.push('nextHint must be a string array');
    else nextHint = input.nextHint;
  }

  let source: FeedbackSource | undefined;
  if (input.source !== undefined) {
    if (
      typeof input.source !== 'string' ||
      !FEEDBACK_SOURCES.includes(input.source as (typeof FEEDBACK_SOURCES)[number])
    ) {
      errors.push(`source must be one of ${FEEDBACK_SOURCES.join(', ')}`);
    } else {
      source = input.source as FeedbackSource;
    }
  }

  const hasContent =
    (ratings !== undefined && Object.keys(ratings).length > 0) ||
    (typeof rawComment === 'string' && rawComment.length > 0) ||
    (quickTags !== undefined && quickTags.length > 0);
  if (!hasContent) {
    errors.push('feedback must include at least one of rawComment, ratings, or quickTags');
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: CreateFeedbackInput = {
    recipeCode: recipeCode as `COF-${string}`
  };
  if (ratings !== undefined) value.ratings = ratings;
  if (rawComment !== undefined) value.rawComment = rawComment;
  if (quickTags !== undefined) value.quickTags = quickTags;
  if (actual !== undefined) value.actual = actual;
  if (comment !== undefined) value.comment = comment;
  if (desiredDirection !== undefined) value.desiredDirection = desiredDirection;
  if (nextHint !== undefined) value.nextHint = nextHint;
  if (source !== undefined) value.source = source;

  return { ok: true, value };
}
