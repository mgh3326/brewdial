// Vendored from packages/shared/src/validation.ts. Re-sync if it changes.
import type { CreateFeedbackInput, CreateRecipeInput } from './api-types';
import { isRecipeCode } from './schemas';
import type {
  ActualBrewParams,
  BrewMethod,
  FeedbackRatings,
  FeedbackSource,
  QuickFeedbackTag,
  RecipeParams,
  RecipeStep
} from './types';
import { QUICK_FEEDBACK_TAGS } from './types';

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[] };

const POUR_OVER_METHODS: ReadonlySet<BrewMethod> = new Set(['v60', 'kalita', 'aeropress']);

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
  return v.trim();
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
      if (typeof step.atSec !== 'number' || !Number.isFinite(step.atSec)) {
        errors.push(`steps[${i}].atSec must be a finite number`);
      } else {
        built.atSec = step.atSec;
      }
    }
    if (step.waterG !== undefined) {
      if (typeof step.waterG !== 'number' || !Number.isFinite(step.waterG)) {
        errors.push(`steps[${i}].waterG must be a finite number`);
      } else {
        built.waterG = step.waterG;
      }
    }
    if (step.endSec !== undefined) {
      if (
        typeof step.endSec !== 'number' ||
        !Number.isFinite(step.endSec) ||
        step.endSec < 0
      ) {
        errors.push(`steps[${i}].endSec must be a non-negative finite number`);
      } else if (typeof step.atSec === 'number' && step.endSec <= step.atSec) {
        errors.push(`steps[${i}].endSec must be greater than atSec`);
      } else {
        built.endSec = step.endSec;
      }
    }
    if (step.pourRateGPerSec !== undefined) {
      if (
        typeof step.pourRateGPerSec !== 'number' ||
        !Number.isFinite(step.pourRateGPerSec) ||
        step.pourRateGPerSec <= 0
      ) {
        errors.push(`steps[${i}].pourRateGPerSec must be a positive finite number`);
      } else {
        built.pourRateGPerSec = step.pourRateGPerSec;
      }
    }
    out.push(built);
  });
  return out;
}

// ROB-608: cross-field arithmetic + range checks. Clear contradictions go to
// `errors` (reject); convention deviations to `warnings` (soft). `method:'other'`
// (instant sticks etc.) is exempt; espresso skips the pour-over water schedule.
function validateRecipeCrossFields(
  value: CreateRecipeInput,
  errors: string[],
  warnings: string[]
): void {
  const { method } = value;
  if (method === 'other') return;

  const params = value.params ?? {};
  const steps = value.steps ?? [];
  const { doseG, waterG, tempC, ratio, targetTimeSec } = params;
  const isPourOver = POUR_OVER_METHODS.has(method);

  if (doseG !== undefined && doseG <= 0) errors.push('params.doseG must be greater than 0');
  if (waterG !== undefined && waterG <= 0) errors.push('params.waterG must be greater than 0');
  if (tempC !== undefined) {
    if (tempC <= 0 || tempC > 100) errors.push('params.tempC must be between 0 and 100');
    else if (tempC < 80) warnings.push(`params.tempC ${tempC}°C is unusually low for hot brewing`);
  }
  if (targetTimeSec !== undefined && targetTimeSec <= 0) {
    errors.push('params.targetTimeSec must be greater than 0');
  }

  if (ratio !== undefined && doseG && waterG) {
    const m = /^\s*1\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio);
    if (m) {
      const declared = Number(m[1]);
      const actual = waterG / doseG;
      if (Number.isFinite(declared) && Math.abs(declared - actual) > 0.3) {
        warnings.push(`ratio ${ratio} disagrees with waterG/doseG (≈1:${actual.toFixed(1)})`);
      }
    }
  }

  const timed = steps
    .filter((s): s is RecipeStep & { atSec: number } => typeof s.atSec === 'number')
    .slice()
    .sort((a, b) => a.atSec - b.atSec);

  for (let i = 1; i < timed.length; i += 1) {
    const prev = timed[i - 1];
    const cur = timed[i];
    if (typeof prev.endSec === 'number' && cur.atSec < prev.endSec) {
      errors.push(
        `steps overlap: a step starts at ${cur.atSec}s before the previous step ends (${prev.endSec}s)`
      );
    }
  }
  if (timed.some((s) => s.endSec === undefined)) {
    warnings.push('a timed step has no endSec; pour timing cannot be fully verified');
  }

  if (isPourOver) {
    const weighted = timed.filter(
      (s): s is RecipeStep & { atSec: number; waterG: number } => typeof s.waterG === 'number'
    );
    for (let i = 1; i < weighted.length; i += 1) {
      if (weighted[i].waterG < weighted[i - 1].waterG) {
        errors.push(
          `cumulative step waterG decreases (${weighted[i - 1].waterG}g → ${weighted[i].waterG}g)`
        );
      }
    }
    if (waterG !== undefined) {
      for (const s of weighted) {
        if (s.waterG > waterG) {
          errors.push(`a step waterG (${s.waterG}g) exceeds total params.waterG (${waterG}g)`);
        }
      }
      const finalG = weighted.at(-1)?.waterG;
      if (finalG !== undefined && Math.abs(finalG - waterG) > 1) {
        warnings.push(`final step waterG (${finalG}g) does not reach params.waterG (${waterG}g)`);
      }
    }
  }

  if (targetTimeSec !== undefined && timed.length > 0) {
    const lastEnd = Math.max(
      ...timed.map((s) => (typeof s.endSec === 'number' ? s.endSec : s.atSec))
    );
    if (targetTimeSec < lastEnd) {
      errors.push(
        `params.targetTimeSec (${targetTimeSec}s) is before the last pour ends (${lastEnd}s)`
      );
    } else if (targetTimeSec - lastEnd > 75) {
      warnings.push(
        `unrealistic drawdown: targetTimeSec (${targetTimeSec}s) is ${targetTimeSec - lastEnd}s after the last pour ends`
      );
    }
    if (isPourOver && (targetTimeSec < 60 || targetTimeSec > 600)) {
      warnings.push(`params.targetTimeSec (${targetTimeSec}s) is outside the typical 60–600s range`);
    }
  }
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

  const warnings: string[] = [];
  validateRecipeCrossFields(value, errors, warnings);
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value, warnings };
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
  if (rawComment !== undefined && rawComment.length > 0) value.rawComment = rawComment;
  if (quickTags !== undefined) value.quickTags = quickTags;
  if (actual !== undefined) value.actual = actual;
  if (comment !== undefined) value.comment = comment;
  if (desiredDirection !== undefined) value.desiredDirection = desiredDirection;
  if (nextHint !== undefined) value.nextHint = nextHint;
  if (source !== undefined) value.source = source;

  return { ok: true, value, warnings: [] };
}
