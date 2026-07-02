import type { CreateFeedbackInput, CreateRecipeInput } from './api-types.js';
import { isRecipeCode } from './schemas.js';
import type {
  ActualBrewParams,
  BeanAttributes,
  BeanAttrsSource,
  BeanFlavorCategory,
  BrewMethod,
  Confidence,
  DripperClass,
  DripperPortability,
  DripperTarget,
  FeedbackRatings,
  FeedbackSource,
  GrindShift,
  GrindSource,
  GrindSpec,
  GrindTarget,
  PerGrinderGrind,
  PourShift,
  QuickFeedbackTag,
  RecipeParams,
  RecipeStep
} from './types.js';
import { BEAN_ATTRS_SOURCES, BEAN_FLAVOR_CATEGORIES, QUICK_FEEDBACK_TAGS } from './types.js';

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
const RECIPE_PARAM_STRING_KEYS = ['ratio', 'grinder', 'brewer'] as const;

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
  // ROB-611: grind is string (legacy free text) | GrindSpec (structured).
  const g = raw.grind;
  if (g !== undefined) {
    if (typeof g === 'string') {
      out.grind = g; // legacy, preserved verbatim
    } else if (isPlainObject(g)) {
      const spec = validateGrindSpec(g, errors);
      if (spec) {
        out.grind = spec;
        // Mirror the cross-grinder invariant into the canonical drawdown field so
        // dedup (ROB-610) stays field-correct with no future params rewrite.
        if (spec.target.targetDrawdownSec !== undefined && out.targetTimeSec === undefined) {
          out.targetTimeSec = spec.target.targetDrawdownSec;
        }
      }
    } else {
      errors.push('params.grind must be a string or a GrindSpec object');
    }
  }
  return out;
}

function validateGrindSpec(
  raw: Record<string, unknown>,
  errors: string[]
): GrindSpec | undefined {
  const target = raw.target;
  if (!isPlainObject(target)) {
    errors.push('params.grind.target must be an object');
    return undefined;
  }
  const t: GrindTarget = {};
  if (target.microns !== undefined) {
    if (typeof target.microns !== 'number' || Number.isNaN(target.microns)) {
      errors.push('params.grind.target.microns must be a number');
    } else {
      t.microns = target.microns;
    }
  }
  if (target.brewMethodPosition !== undefined) {
    if (typeof target.brewMethodPosition !== 'string') {
      errors.push('params.grind.target.brewMethodPosition must be a string');
    } else {
      t.brewMethodPosition = target.brewMethodPosition;
    }
  }
  if (target.targetDrawdownSec !== undefined) {
    if (typeof target.targetDrawdownSec !== 'number' || !Number.isFinite(target.targetDrawdownSec)) {
      errors.push('params.grind.target.targetDrawdownSec must be a finite number');
    } else {
      t.targetDrawdownSec = target.targetDrawdownSec;
    }
  }
  // 611 trust order: absolute microns are unreliable; require a robust anchor.
  if (t.brewMethodPosition === undefined && t.targetDrawdownSec === undefined) {
    errors.push('params.grind.target must include brewMethodPosition or targetDrawdownSec');
    return undefined;
  }
  const spec: GrindSpec = { target: t };
  if (raw.perGrinder !== undefined) {
    if (!Array.isArray(raw.perGrinder)) {
      errors.push('params.grind.perGrinder must be an array');
    } else if (raw.perGrinder.length > 10) {
      errors.push('params.grind.perGrinder must have at most 10 entries');
    } else {
      const pg: PerGrinderGrind[] = [];
      raw.perGrinder.forEach((item, i) => {
        if (!isPlainObject(item)) {
          errors.push(`params.grind.perGrinder[${i}] must be an object`);
          return;
        }
        if (typeof item.grinder !== 'string' || item.grinder.trim().length === 0) {
          errors.push(`params.grind.perGrinder[${i}].grinder must be a non-empty string`);
          return;
        }
        if (typeof item.clicks !== 'number' && typeof item.clicks !== 'string') {
          errors.push(`params.grind.perGrinder[${i}].clicks must be a number or string`);
          return;
        }
        if (item.source !== 'measured' && item.source !== 'dial-in-start') {
          errors.push(`params.grind.perGrinder[${i}].source must be 'measured' or 'dial-in-start'`);
          return;
        }
        const entry: PerGrinderGrind = {
          grinder: item.grinder,
          clicks: item.clicks,
          source: item.source as GrindSource
        };
        if (typeof item.grinderId === 'string') entry.grinderId = item.grinderId;
        if (typeof item.stepless === 'boolean') entry.stepless = item.stepless;
        if (entry.stepless && typeof item.clicks !== 'string') {
          errors.push(`params.grind.perGrinder[${i}].clicks must be a string for a stepless grinder`);
        }
        pg.push(entry);
      });
      if (pg.length > 0) spec.perGrinder = pg;
    }
  }
  if (raw.legacyText !== undefined) {
    if (typeof raw.legacyText !== 'string') {
      errors.push('params.grind.legacyText must be a string');
    } else {
      spec.legacyText = raw.legacyText;
    }
  }
  return spec;
}

const DRIPPER_CLASSES = ['bed_restricted', 'dripper_restricted', 'hybrid', 'immersion'] as const;
const SIZE_MATCHES = ['ok', 'undersized', 'oversized'] as const;
const BED_DEPTH_SHIFTS = ['shallower', 'deeper', 'similar'] as const;
const GRIND_SHIFTS = ['coarser', 'finer', 'none'] as const;
const POUR_SHIFTS = ['gentler', 'more_agitation', 'fewer_pours', 'more_pours', 'none'] as const;
const CONFIDENCES = ['high', 'medium', 'low'] as const;

// ROB-612: validate the dripper-portability layer (anchors + class + size match +
// adjustment directions). Whitelist-copy; lives outside params.
function validateDripperPortability(
  raw: Record<string, unknown>,
  errors: string[]
): DripperPortability | undefined {
  const origin = raw.origin;
  if (!isPlainObject(origin) || typeof origin.dripper !== 'string' || origin.dripper.trim() === '') {
    errors.push('dripperPortability.origin.dripper is required');
    return undefined;
  }
  const out: DripperPortability = { origin: { dripper: origin.dripper }, anchors: {} };
  if (typeof origin.dripperId === 'string') out.origin.dripperId = origin.dripperId;
  if (typeof origin.sizeModel === 'string') out.origin.sizeModel = origin.sizeModel;

  const anchors = raw.anchors;
  if (anchors !== undefined) {
    if (!isPlainObject(anchors)) {
      errors.push('dripperPortability.anchors must be an object');
    } else {
      if (typeof anchors.ratio === 'string') out.anchors.ratio = anchors.ratio;
      if (typeof anchors.tempC === 'number') out.anchors.tempC = anchors.tempC;
      if (typeof anchors.targetDrawdownSec === 'number') {
        out.anchors.targetDrawdownSec = anchors.targetDrawdownSec;
      }
    }
  }

  if (raw.classNote !== undefined) {
    if (typeof raw.classNote !== 'string') errors.push('dripperPortability.classNote must be a string');
    else out.classNote = raw.classNote;
  }

  if (raw.targets !== undefined) {
    if (!Array.isArray(raw.targets)) {
      errors.push('dripperPortability.targets must be an array');
    } else if (raw.targets.length > 30) {
      errors.push('dripperPortability.targets must have at most 30 entries');
    } else {
      const targets: DripperTarget[] = [];
      raw.targets.forEach((t, i) => {
        const p = `dripperPortability.targets[${i}]`;
        if (!isPlainObject(t)) {
          errors.push(`${p} must be an object`);
          return;
        }
        if (typeof t.dripper !== 'string' || t.dripper.trim() === '') {
          errors.push(`${p}.dripper must be a non-empty string`);
          return;
        }
        if (!(DRIPPER_CLASSES as readonly string[]).includes(t.class as string)) {
          errors.push(`${p}.class must be one of ${DRIPPER_CLASSES.join(', ')}`);
          return;
        }
        if (!(SIZE_MATCHES as readonly string[]).includes(t.sizeMatch as string)) {
          errors.push(`${p}.sizeMatch must be one of ${SIZE_MATCHES.join(', ')}`);
          return;
        }
        if (!(GRIND_SHIFTS as readonly string[]).includes(t.grindShift as string)) {
          errors.push(`${p}.grindShift must be one of ${GRIND_SHIFTS.join(', ')}`);
          return;
        }
        if (!(POUR_SHIFTS as readonly string[]).includes(t.pourShift as string)) {
          errors.push(`${p}.pourShift must be one of ${POUR_SHIFTS.join(', ')}`);
          return;
        }
        if (!(CONFIDENCES as readonly string[]).includes(t.confidence as string)) {
          errors.push(`${p}.confidence must be one of ${CONFIDENCES.join(', ')}`);
          return;
        }
        const entry: DripperTarget = {
          dripper: t.dripper,
          class: t.class as DripperClass,
          sizeMatch: t.sizeMatch as DripperTarget['sizeMatch'],
          grindShift: t.grindShift as GrindShift,
          pourShift: t.pourShift as PourShift,
          confidence: t.confidence as Confidence
        };
        if (typeof t.dripperId === 'string') entry.dripperId = t.dripperId;
        if ((BED_DEPTH_SHIFTS as readonly string[]).includes(t.bedDepthShift as string)) {
          entry.bedDepthShift = t.bedDepthShift as DripperTarget['bedDepthShift'];
        }
        if (typeof t.bedOverflow === 'boolean') entry.bedOverflow = t.bedOverflow;
        if (t.warn !== undefined) {
          if (typeof t.warn !== 'string') errors.push(`${p}.warn must be a string`);
          else if (t.warn.length > 280) errors.push(`${p}.warn must be at most 280 characters`);
          else entry.warn = t.warn;
        }
        if (typeof t.note === 'string') entry.note = t.note;
        targets.push(entry);
      });
      if (targets.length > 0) out.targets = targets;
    }
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

  let dripperPortability: DripperPortability | undefined;
  if (input.dripperPortability !== undefined) {
    if (!isPlainObject(input.dripperPortability)) {
      errors.push('dripperPortability must be an object');
    } else {
      dripperPortability = validateDripperPortability(input.dripperPortability, errors);
    }
  }

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
  if (dripperPortability !== undefined) value.dripperPortability = dripperPortability;

  const warnings: string[] = [];
  validateRecipeCrossFields(value, errors, warnings);
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value, warnings };
}

// ROB-605/611/612: validate a partial recipe UPDATE. Only present fields are
// validated (no required method/title), through the SAME validators as create so
// agent-supplied params/grind/steps/beanSnapshot/dripperPortability cannot reach
// the DB unchecked on the update path.
export function validateUpdateRecipeInput(
  input: unknown
): ValidationResult<Partial<CreateRecipeInput>> {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['input must be an object'] };

  const value: Partial<CreateRecipeInput> = {};
  if (input.title !== undefined) {
    if (!isNonEmptyString(input.title)) errors.push('title must be a non-empty string');
    else value.title = (input.title as string).trim();
  }
  if (input.params !== undefined) {
    const p = validateRecipeParams(input.params, errors);
    if (p !== undefined) value.params = p;
  }
  if (input.steps !== undefined) {
    const s = validateRecipeSteps(input.steps, errors);
    if (s !== undefined) value.steps = s;
  }
  if (input.notes !== undefined) {
    const n = pickString(input, 'notes', errors, 'input');
    if (n !== undefined) value.notes = n;
  }
  if (input.intent !== undefined) {
    if (!isStringArray(input.intent)) errors.push('intent must be a string array');
    else value.intent = input.intent;
  }
  if (input.beanSnapshot !== undefined) {
    const b = validateBeanSnapshot(input.beanSnapshot, errors);
    if (b !== undefined) value.beanSnapshot = b;
  }
  if (input.adjustmentFromPrevious !== undefined) {
    const a = pickString(input, 'adjustmentFromPrevious', errors, 'input');
    if (a !== undefined) value.adjustmentFromPrevious = a;
  }
  if (input.dripperPortability !== undefined) {
    if (!isPlainObject(input.dripperPortability)) {
      errors.push('dripperPortability must be an object');
    } else {
      const d = validateDripperPortability(input.dripperPortability, errors);
      if (d !== undefined) value.dripperPortability = d;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value, warnings: [] };
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

// ── ROB-654: bean attribute writes (agent PATCH + MCP tool). At least one field
// required. The DB CHECK constraints are the backstop; this returns clean 400s.
export function validateUpdateBeanAttributesInput(
  input: unknown
): ValidationResult<BeanAttributes> {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['input must be an object'] };

  const value: BeanAttributes = {};

  if (input.roastLevelOrd !== undefined) {
    if (!isInt(input.roastLevelOrd) || input.roastLevelOrd < 1 || input.roastLevelOrd > 5) {
      errors.push('roastLevelOrd must be an integer 1-5');
    } else value.roastLevelOrd = input.roastLevelOrd;
  }
  if (input.acidity !== undefined) {
    if (!isInt(input.acidity) || input.acidity < 1 || input.acidity > 5) {
      errors.push('acidity must be an integer 1-5');
    } else value.acidity = input.acidity;
  }
  if (input.body !== undefined) {
    if (!isInt(input.body) || input.body < 1 || input.body > 5) {
      errors.push('body must be an integer 1-5');
    } else value.body = input.body;
  }
  if (input.agtronMin !== undefined) {
    if (!isInt(input.agtronMin) || input.agtronMin < 0 || input.agtronMin > 150) {
      errors.push('agtronMin must be an integer 0-150');
    } else value.agtronMin = input.agtronMin;
  }
  if (input.agtronMax !== undefined) {
    if (!isInt(input.agtronMax) || input.agtronMax < 0 || input.agtronMax > 150) {
      errors.push('agtronMax must be an integer 0-150');
    } else value.agtronMax = input.agtronMax;
  }
  if (
    value.agtronMin !== undefined &&
    value.agtronMax !== undefined &&
    value.agtronMax < value.agtronMin
  ) {
    errors.push('agtronMax must be >= agtronMin');
  }
  if (input.decaf !== undefined) {
    if (typeof input.decaf !== 'boolean') errors.push('decaf must be a boolean');
    else value.decaf = input.decaf;
  }
  if (input.flavorCategories !== undefined) {
    if (!isStringArray(input.flavorCategories)) {
      errors.push('flavorCategories must be a string array');
    } else {
      const allowed = new Set<string>(BEAN_FLAVOR_CATEGORIES);
      const invalid = input.flavorCategories.filter((t) => !allowed.has(t));
      if (invalid.length > 0) {
        errors.push(
          `flavorCategories contains unknown values: ${invalid.join(', ')} (allowed: ${BEAN_FLAVOR_CATEGORIES.join(', ')})`
        );
      } else {
        value.flavorCategories = input.flavorCategories as BeanFlavorCategory[];
      }
    }
  }
  if (input.attrsSource !== undefined) {
    if (
      typeof input.attrsSource !== 'string' ||
      !BEAN_ATTRS_SOURCES.includes(input.attrsSource as BeanAttrsSource)
    ) {
      errors.push(`attrsSource must be one of ${BEAN_ATTRS_SOURCES.join(', ')}`);
    } else {
      value.attrsSource = input.attrsSource as BeanAttrsSource;
    }
  }
  const sourceUrl = pickString(input, 'sourceUrl', errors, 'input');
  if (sourceUrl !== undefined && sourceUrl.length > 0) value.sourceUrl = sourceUrl;
  const attrsNotes = pickString(input, 'attrsNotes', errors, 'input');
  if (attrsNotes !== undefined && attrsNotes.length > 0) value.attrsNotes = attrsNotes;

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push('at least one bean attribute is required');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value, warnings: [] };
}
