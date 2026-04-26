# PR4 — Recipe / Feedback API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Recipe / Feedback API foundation on top of the existing CouchDB client — shared API types, runtime validation helpers, counter-backed recipe code generation, recipe + feedback repositories, and SvelteKit JSON API routes — landed as PR `feat/recipe-feedback-api` against `main` on `git@github.com:mgh3326/brewdial`.

**Architecture:** Layered: SvelteKit `+server.ts` route handlers → server-only repository helpers in `apps/web/src/lib/server/repositories/` → existing `fetch`-based CouchDB client (`apps/web/src/lib/server/couch.ts`). Listing uses CouchDB `_all_docs` prefix ranges (no Mango indexes). Recipe codes (`COF-0001` ...) are minted from a CouchDB counter document `counter:recipe` with `_rev`-conflict retry. Validation lives in `@brewdial/shared` as small explicit helpers (no `zod`).

**Tech Stack:** pnpm@10.33.2, Node ≥22, TypeScript, SvelteKit, plain CSS, CouchDB via HTTP, Vitest.

**Reference spec / source prompt:** `brewdial-pr4-recipe-feedback-api.md` (passed in by the user; not committed under `docs/superpowers/specs/`).

---

## Pre-flight

Run from the local repository root (current working directory). Confirm:

- `pnpm --version` reports `10.33.2`
- `node --version` reports `>=22`
- `git remote -v` shows `git@github.com:mgh3326/brewdial`
- Latest `main` includes PR3 (`feat: add couchdb foundation (#3)` — commit `36ca5e2` or later)
- Working tree clean

If those check out, create the feature branch in **Task 1**.

---

## File map

| Path | Action | Owner Task |
| --- | --- | --- |
| `packages/shared/src/types.ts` | modify (add `CounterDoc`, extend `BrewDialDoc`) | T2 |
| `packages/shared/src/api-types.ts` | create | T3 |
| `packages/shared/src/index.ts` | modify (re-export new modules) | T3, T4 |
| `packages/shared/src/validation.ts` | create | T4 |
| `packages/shared/src/validation.test.ts` | create | T4 |
| `apps/web/src/lib/server/couch.ts` | modify (add `getAllDocuments`) | T5 |
| `apps/web/src/lib/server/couch.test.ts` | modify (add `getAllDocuments` test) | T5 |
| `apps/web/src/lib/server/errors.ts` | create | T6 |
| `apps/web/src/lib/server/repositories/counters.ts` | create | T7 |
| `apps/web/src/lib/server/repositories/counters.test.ts` | create | T7 |
| `apps/web/src/lib/server/repositories/recipes.ts` | create | T8 |
| `apps/web/src/lib/server/repositories/recipes.test.ts` | create | T8 |
| `apps/web/src/lib/server/repositories/feedback.ts` | create | T9 |
| `apps/web/src/lib/server/repositories/feedback.test.ts` | create | T9 |
| `apps/web/src/routes/api/recipes/+server.ts` | create | T10 |
| `apps/web/src/routes/api/recipes/[code]/+server.ts` | create | T11 |
| `apps/web/src/routes/api/feedback/+server.ts` | create | T12 |
| `README.md` | modify (add Recipe / Feedback API section) | T13 |
| `docs/decisions/0003-recipe-feedback-api.md` | create | T13 |

---

## Task 1: Create the feature branch

**Files:** none

- [ ] **Step 1: Sync `main` and confirm PR3 is the tip**

```bash
git checkout main
git pull --ff-only
git log --oneline -1
```

Expected: top line is `36ca5e2 feat: add couchdb foundation (#3)` or a later `main` commit that mentions the CouchDB foundation.

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/recipe-feedback-api
```

Expected: `Switched to a new branch 'feat/recipe-feedback-api'`.

- [ ] **Step 3: Confirm clean tree and node/pnpm versions**

```bash
git status --short --branch
pnpm --version
node --version
```

Expected: branch line `## feat/recipe-feedback-api`, no other output from `git status`; `pnpm` reports `10.33.2`; `node` reports `>=22`.

---

## Task 2: Add `CounterDoc` to shared types

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Append `CounterDoc` and extend `BrewDialDoc`**

Edit `packages/shared/src/types.ts`. Replace the existing final line:

```ts
export type BrewDialDoc = RecipeDoc | FeedbackDoc | PreferenceDoc;
```

with:

```ts
export interface CounterDoc {
  _id: `counter:${string}`;
  _rev?: string;
  type: 'counter';
  next: number;
  createdAt: string;
  updatedAt: string;
}

export type BrewDialDoc = RecipeDoc | FeedbackDoc | PreferenceDoc | CounterDoc;
```

Do not rename any existing field on `RecipeDoc`, `FeedbackDoc`, or `PreferenceDoc`.

- [ ] **Step 2: Verify `pnpm check` still passes**

Run: `pnpm check`
Expected: PASS, no new TS errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add CounterDoc type"
```

---

## Task 3: Add public API input/output types

**Files:**
- Create: `packages/shared/src/api-types.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/src/api-types.ts`**

```ts
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
```

- [ ] **Step 2: Re-export from `packages/shared/src/index.ts`**

Replace the file with:

```ts
export * from './types';
export * from './schemas';
export * from './feedback-rules';
export * from './api-types';
```

- [ ] **Step 3: Verify check passes**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/api-types.ts packages/shared/src/index.ts
git commit -m "feat(shared): add recipe/feedback API input + response types"
```

---

## Task 4: Validation helpers + tests (TDD)

**Files:**
- Create: `packages/shared/src/validation.ts`
- Create: `packages/shared/src/validation.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/shared/src/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  validateCreateFeedbackInput,
  validateCreateRecipeInput
} from './validation';

describe('validateCreateRecipeInput', () => {
  it('accepts a minimal valid input and strips unknown fields', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'Test V60',
      bogus: 'should be dropped'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.method).toBe('v60');
      expect(result.value.title).toBe('Test V60');
      expect((result.value as Record<string, unknown>).bogus).toBeUndefined();
    }
  });

  it('accepts a full valid input including params, steps, and beanSnapshot', () => {
    const result = validateCreateRecipeInput({
      method: 'espresso',
      title: 'Morning shot',
      params: { doseG: 18, waterG: 36, tempC: 93 },
      steps: [{ atSec: 0, waterG: 0, note: 'Pre-infuse' }],
      intent: ['sweeter'],
      adjustmentFromPrevious: 'finer grind',
      createdBy: 'agent',
      beanId: 'bean:abc',
      beanSnapshot: { name: 'Geisha', roaster: 'Tim', roastDate: '2026-04-01' }
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when input is not an object', () => {
    const result = validateCreateRecipeInput('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects missing title', () => {
    const result = validateCreateRecipeInput({ method: 'v60' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/title/);
  });

  it('rejects empty title', () => {
    const result = validateCreateRecipeInput({ method: 'v60', title: '   ' });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid method', () => {
    const result = validateCreateRecipeInput({ method: 'french-press', title: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/method/);
  });

  it('rejects a step missing note', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'X',
      steps: [{ atSec: 0, waterG: 40 }]
    });
    expect(result.ok).toBe(false);
  });
});

describe('validateCreateFeedbackInput', () => {
  it('accepts a minimal valid feedback', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      ratings: { overall: 4 }
    });
    expect(result.ok).toBe(true);
  });

  it('accepts feedback with sensory ratings, actual, and arrays', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0042',
      ratings: { overall: 5, sweetness: 3, burnt: 1 },
      actual: { tempC: 92, grind: 'medium', timeSec: 180 },
      comment: 'Solid',
      desiredDirection: ['sweeter'],
      nextHint: ['try +2C'],
      source: 'agent'
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when input is not an object', () => {
    expect(validateCreateFeedbackInput(null).ok).toBe(false);
  });

  it('rejects an invalid recipeCode shape', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'XYZ-1',
      ratings: { overall: 4 }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/recipeCode/);
  });

  it('rejects when ratings has no fields', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      ratings: {}
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/ratings/);
  });

  it('rejects when overall is out of range', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      ratings: { overall: 6 }
    });
    expect(result.ok).toBe(false);
  });

  it('rejects when a sensory rating is out of range', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      ratings: { sweetness: 5 }
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @brewdial/shared test`
Expected: FAIL with errors complaining that `./validation` cannot be resolved.

- [ ] **Step 3: Implement `packages/shared/src/validation.ts`**

```ts
import type { CreateFeedbackInput, CreateRecipeInput } from './api-types';
import { isRecipeCode } from './schemas';
import type {
  ActualBrewParams,
  BrewMethod,
  FeedbackRatings,
  RecipeParams,
  RecipeStep
} from './types';

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

const FEEDBACK_SOURCES = ['web', 'agent', 'mcp'] as const;
const CREATED_BY_VALUES = ['agent', 'manual'] as const;

const RECIPE_PARAM_NUMBER_KEYS = ['doseG', 'waterG', 'tempC', 'targetTimeSec'] as const;
const RECIPE_PARAM_STRING_KEYS = ['ratio', 'grind'] as const;

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
  if (name !== undefined) out.name = name;
  if (roaster !== undefined) out.roaster = roaster;
  if (roastDate !== undefined) out.roastDate = roastDate;
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
  if (adjustmentFromPrevious !== undefined) value.adjustmentFromPrevious = adjustmentFromPrevious;
  if (createdBy !== undefined) value.createdBy = createdBy;

  return { ok: true, value };
}

function validateRatings(
  raw: unknown,
  errors: string[]
): FeedbackRatings | undefined {
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
  if (Object.keys(out).length === 0) {
    errors.push('ratings must include at least one rating field');
    return undefined;
  }
  return out;
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

  const comment = pickString(input, 'comment', errors, 'input');

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

  let source: 'web' | 'agent' | 'mcp' | undefined;
  if (input.source !== undefined) {
    if (
      typeof input.source !== 'string' ||
      !FEEDBACK_SOURCES.includes(input.source as (typeof FEEDBACK_SOURCES)[number])
    ) {
      errors.push(`source must be one of ${FEEDBACK_SOURCES.join(', ')}`);
    } else {
      source = input.source as 'web' | 'agent' | 'mcp';
    }
  }

  if (errors.length > 0 || ratings === undefined) {
    return { ok: false, errors };
  }

  const value: CreateFeedbackInput = {
    recipeCode: recipeCode as `COF-${string}`,
    ratings
  };
  if (actual !== undefined) value.actual = actual;
  if (comment !== undefined) value.comment = comment;
  if (desiredDirection !== undefined) value.desiredDirection = desiredDirection;
  if (nextHint !== undefined) value.nextHint = nextHint;
  if (source !== undefined) value.source = source;

  return { ok: true, value };
}
```

- [ ] **Step 4: Re-export validation from the shared index**

Edit `packages/shared/src/index.ts` to:

```ts
export * from './types';
export * from './schemas';
export * from './feedback-rules';
export * from './api-types';
export * from './validation';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @brewdial/shared test`
Expected: PASS for all `validation.test.ts` cases (plus existing `feedback-rules.test.ts`).

- [ ] **Step 6: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/validation.ts packages/shared/src/validation.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add manual validation helpers for recipe/feedback input"
```

---

## Task 5: Add `getAllDocuments` helper to the CouchDB client

**Files:**
- Modify: `apps/web/src/lib/server/couch.ts`
- Modify: `apps/web/src/lib/server/couch.test.ts`

We need a small helper for `_all_docs` prefix queries; everything else in `couch.ts` already exists.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/server/couch.test.ts` inside the existing file (after the last `describe`):

```ts
import { getAllDocuments } from './couch';

describe('getAllDocuments', () => {
  it('builds a _all_docs URL with startkey/endkey/include_docs/limit and returns rows.doc', async () => {
    const captured: { url?: string; method?: string } = {};
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.method = init?.method ?? 'GET';
      return new Response(
        JSON.stringify({
          total_rows: 2,
          offset: 0,
          rows: [
            { id: 'recipe:COF-0001', key: 'recipe:COF-0001', value: { rev: '1-x' }, doc: { _id: 'recipe:COF-0001', _rev: '1-x', type: 'recipe' } },
            { id: 'recipe:COF-0002', key: 'recipe:COF-0002', value: { rev: '1-y' }, doc: { _id: 'recipe:COF-0002', _rev: '1-y', type: 'recipe' } }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const docs = await getAllDocuments<{ _id: string; _rev: string; type: string }>(
      baseConfig,
      { startkey: 'recipe:', endkey: 'recipe:￰', includeDocs: true, limit: 50 },
      fetchImpl
    );

    expect(docs).toHaveLength(2);
    expect(docs[0]._id).toBe('recipe:COF-0001');
    expect(captured.method).toBe('GET');
    expect(captured.url).toContain('/coffee/_all_docs');
    expect(captured.url).toContain('include_docs=true');
    expect(captured.url).toContain('limit=50');
    // startkey and endkey must be JSON-encoded strings, then URL-encoded
    expect(captured.url).toContain('startkey=' + encodeURIComponent('"recipe:"'));
    expect(captured.url).toContain('endkey=' + encodeURIComponent('"recipe:￰"'));
  });

  it('skips rows whose doc is missing when includeDocs is true', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      body: {
        total_rows: 1,
        offset: 0,
        rows: [{ id: 'recipe:COF-0001', key: 'recipe:COF-0001', value: { rev: '1-x' } }]
      }
    });
    const docs = await getAllDocuments<{ _id: string }>(
      baseConfig,
      { startkey: 'recipe:', endkey: 'recipe:￰', includeDocs: true },
      fetchImpl
    );
    expect(docs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @brewdial/web test`
Expected: FAIL — `getAllDocuments` is not exported from `./couch`.

- [ ] **Step 3: Implement `getAllDocuments` in `apps/web/src/lib/server/couch.ts`**

Append at the end of the file:

```ts
export interface AllDocsOptions {
  startkey?: string;
  endkey?: string;
  includeDocs?: boolean;
  limit?: number;
  descending?: boolean;
}

interface AllDocsRow<T> {
  id: string;
  key: string;
  value: { rev: string };
  doc?: T;
}

interface AllDocsResponse<T> {
  total_rows: number;
  offset: number;
  rows: AllDocsRow<T>[];
}

export async function getAllDocuments<T>(
  config: CouchConfig,
  options: AllDocsOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<T[]> {
  const params = new URLSearchParams();
  if (options.startkey !== undefined) params.set('startkey', JSON.stringify(options.startkey));
  if (options.endkey !== undefined) params.set('endkey', JSON.stringify(options.endkey));
  if (options.includeDocs) params.set('include_docs', 'true');
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.descending) params.set('descending', 'true');

  const query = params.toString();
  const path =
    `/${encodeURIComponent(config.database)}/_all_docs` + (query ? `?${query}` : '');

  const body = await couchRequest<AllDocsResponse<T>>(
    config,
    path,
    { method: 'GET' },
    fetchImpl
  );

  if (!options.includeDocs) {
    return body.rows.map((row) => row as unknown as T);
  }
  return body.rows
    .map((row) => row.doc)
    .filter((doc): doc is T => doc !== undefined);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @brewdial/web test`
Expected: PASS for new `getAllDocuments` cases plus the existing CouchDB tests.

- [ ] **Step 5: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/couch.ts apps/web/src/lib/server/couch.test.ts
git commit -m "feat(web): add getAllDocuments helper for _all_docs prefix queries"
```

---

## Task 6: Add domain error classes

**Files:**
- Create: `apps/web/src/lib/server/errors.ts`

We keep this minimal — just two named errors that route handlers can map.

- [ ] **Step 1: Create `apps/web/src/lib/server/errors.ts`**

```ts
export class BadRequestError extends Error {
  status = 400 as const;
  details?: string[];
  constructor(message: string, details?: string[]) {
    super(message);
    this.name = 'BadRequestError';
    this.details = details;
  }
}

export class NotFoundError extends Error {
  status = 404 as const;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
```

- [ ] **Step 2: Verify `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/errors.ts
git commit -m "feat(web): add BadRequestError and NotFoundError domain errors"
```

---

## Task 7: Counter repository with conflict retry (TDD)

**Files:**
- Create: `apps/web/src/lib/server/repositories/counters.ts`
- Create: `apps/web/src/lib/server/repositories/counters.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/server/repositories/counters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextRecipeCode } from './counters';
import type { CouchConfig } from '../config';

const config: CouchConfig = { url: 'http://127.0.0.1:5984', database: 'coffee' };

interface FakeStore {
  doc?: { _id: string; _rev?: string; type: 'counter'; next: number; createdAt: string; updatedAt: string };
  rev: number;
}

function makeFetch(store: FakeStore, opts: { putConflictsRemaining?: number } = {}): typeof fetch {
  let putConflictsRemaining = opts.putConflictsRemaining ?? 0;
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname; // /coffee/counter:recipe (id is encoded)
    const isCounterDoc = decodeURIComponent(path) === '/coffee/counter:recipe';
    const method = init?.method ?? 'GET';

    if (isCounterDoc && method === 'GET') {
      if (!store.doc) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(store.doc), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (isCounterDoc && method === 'PUT') {
      if (putConflictsRemaining > 0) {
        putConflictsRemaining -= 1;
        // Simulate someone else racing the write: bump store.doc to a newer rev.
        if (store.doc) {
          store.rev += 1;
          store.doc = { ...store.doc, _rev: `${store.rev}-x`, next: store.doc.next + 1 };
        } else {
          // Rare: created concurrently
          store.rev += 1;
          store.doc = {
            _id: 'counter:recipe',
            _rev: `${store.rev}-x`,
            type: 'counter',
            next: 2,
            createdAt: 'now',
            updatedAt: 'now'
          };
        }
        return new Response(JSON.stringify({ error: 'conflict' }), {
          status: 409,
          headers: { 'content-type': 'application/json' }
        });
      }
      const body = JSON.parse(init!.body as string) as FakeStore['doc'];
      store.rev += 1;
      store.doc = { ...body!, _rev: `${store.rev}-x` };
      return new Response(
        JSON.stringify({ ok: true, id: store.doc!._id, rev: store.doc!._rev }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response('not handled', { status: 500 });
  }) as unknown as typeof fetch;
}

describe('nextRecipeCode', () => {
  it('creates the counter and returns COF-0001 the first time', async () => {
    const store: FakeStore = { rev: 0 };
    const code = await nextRecipeCode(config, makeFetch(store));
    expect(code).toBe('COF-0001');
    expect(store.doc?.next).toBe(2);
  });

  it('returns COF-0002 when next is 2', async () => {
    const store: FakeStore = {
      rev: 1,
      doc: {
        _id: 'counter:recipe',
        _rev: '1-x',
        type: 'counter',
        next: 2,
        createdAt: 'now',
        updatedAt: 'now'
      }
    };
    const code = await nextRecipeCode(config, makeFetch(store));
    expect(code).toBe('COF-0002');
    expect(store.doc?.next).toBe(3);
  });

  it('retries on _rev conflict and ultimately succeeds', async () => {
    const store: FakeStore = {
      rev: 1,
      doc: {
        _id: 'counter:recipe',
        _rev: '1-x',
        type: 'counter',
        next: 5,
        createdAt: 'now',
        updatedAt: 'now'
      }
    };
    const code = await nextRecipeCode(config, makeFetch(store, { putConflictsRemaining: 1 }));
    // After 1 conflict bumped next to 6, the retry sees next=6 and returns COF-0006.
    expect(code).toBe('COF-0006');
    expect(store.doc?.next).toBe(7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @brewdial/web test`
Expected: FAIL — `./counters` does not export `nextRecipeCode`.

- [ ] **Step 3: Implement `apps/web/src/lib/server/repositories/counters.ts`**

```ts
import type { CounterDoc } from '@brewdial/shared';
import type { CouchConfig } from '../config';
import { CouchError, getDocument, putDocument } from '../couch';

const COUNTER_ID = 'counter:recipe';
const MAX_RETRIES = 3;

function pad4(value: number): string {
  return value.toString().padStart(4, '0');
}

export async function nextRecipeCode(
  config: CouchConfig,
  fetchImpl: typeof fetch = fetch
): Promise<`COF-${string}`> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const now = new Date().toISOString();
    const existing = await getDocument<CounterDoc>(config, COUNTER_ID, fetchImpl);
    const current = existing?.next ?? 1;
    const updated: CounterDoc = existing
      ? { ...existing, next: current + 1, updatedAt: now }
      : {
          _id: 'counter:recipe',
          type: 'counter',
          next: current + 1,
          createdAt: now,
          updatedAt: now
        };

    try {
      await putDocument(config, updated, fetchImpl);
      return `COF-${pad4(current)}`;
    } catch (err) {
      if (err instanceof CouchError && err.status === 409) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('nextRecipeCode failed after retries');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @brewdial/web test`
Expected: PASS for `counters.test.ts` plus all earlier suites.

- [ ] **Step 5: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/repositories/counters.ts apps/web/src/lib/server/repositories/counters.test.ts
git commit -m "feat(web): add counter:recipe-backed nextRecipeCode with conflict retry"
```

---

## Task 8: Recipe repository (TDD)

**Files:**
- Create: `apps/web/src/lib/server/repositories/recipes.ts`
- Create: `apps/web/src/lib/server/repositories/recipes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/server/repositories/recipes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createRecipe,
  getRecipeByCode,
  listRecentRecipes
} from './recipes';
import type { CouchConfig } from '../config';

const config: CouchConfig = { url: 'http://127.0.0.1:5984', database: 'coffee' };

interface RouteResult {
  status: number;
  body: unknown;
}

type RouteHandler = (init: RequestInit | undefined, url: URL) => RouteResult;

function makeRouter(routes: Record<string, RouteHandler>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const key = `${init?.method ?? 'GET'} ${decodeURIComponent(u.pathname)}`;
    const handler = routes[key];
    if (!handler) {
      return new Response(`unhandled ${key}`, { status: 500 });
    }
    const result = handler(init, u);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' }
    });
  }) as unknown as typeof fetch;
}

describe('createRecipe', () => {
  it('mints COF-0001, stores recipe:COF-0001, and returns the doc with _rev', async () => {
    const calls: { putBody?: Record<string, unknown> } = {};
    const fetchImpl = makeRouter({
      'GET /coffee/counter:recipe': () => ({ status: 404, body: { error: 'not_found' } }),
      'PUT /coffee/counter:recipe': () => ({
        status: 201,
        body: { ok: true, id: 'counter:recipe', rev: '1-c' }
      }),
      'PUT /coffee/recipe:COF-0001': (init) => {
        calls.putBody = JSON.parse(init!.body as string);
        return {
          status: 201,
          body: { ok: true, id: 'recipe:COF-0001', rev: '1-r' }
        };
      }
    });

    const recipe = await createRecipe(
      config,
      { method: 'v60', title: 'Test V60' },
      fetchImpl
    );

    expect(recipe._id).toBe('recipe:COF-0001');
    expect(recipe.code).toBe('COF-0001');
    expect(recipe._rev).toBe('1-r');
    expect(recipe.version).toBe(1);
    expect(recipe.params).toEqual({});
    expect(recipe.steps).toEqual([]);
    expect(recipe.createdBy).toBe('manual');
    expect(recipe.createdAt).toBe(recipe.updatedAt);
    expect(calls.putBody?.title).toBe('Test V60');
  });
});

describe('getRecipeByCode', () => {
  it('returns the doc when CouchDB returns 200', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/recipe:COF-0001': () => ({
        status: 200,
        body: {
          _id: 'recipe:COF-0001',
          _rev: '1-r',
          type: 'recipe',
          code: 'COF-0001',
          method: 'v60',
          version: 1,
          title: 'X',
          params: {},
          steps: [],
          createdBy: 'manual',
          createdAt: 'now',
          updatedAt: 'now'
        }
      })
    });
    const recipe = await getRecipeByCode(config, 'COF-0001', fetchImpl);
    expect(recipe?._id).toBe('recipe:COF-0001');
  });

  it('returns null on 404', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/recipe:COF-9999': () => ({ status: 404, body: { error: 'not_found' } })
    });
    const recipe = await getRecipeByCode(config, 'COF-9999', fetchImpl);
    expect(recipe).toBeNull();
  });
});

describe('listRecentRecipes', () => {
  it('returns recipe docs from _all_docs rows, newest first by createdAt, capped by limit', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/_all_docs': () => ({
        status: 200,
        body: {
          total_rows: 3,
          offset: 0,
          rows: [
            { id: 'recipe:COF-0001', key: 'recipe:COF-0001', value: { rev: '1-a' }, doc: { _id: 'recipe:COF-0001', _rev: '1-a', type: 'recipe', code: 'COF-0001', method: 'v60', version: 1, title: 'A', params: {}, steps: [], createdBy: 'manual', createdAt: '2026-04-20T00:00:00Z', updatedAt: '2026-04-20T00:00:00Z' } },
            { id: 'recipe:COF-0002', key: 'recipe:COF-0002', value: { rev: '1-b' }, doc: { _id: 'recipe:COF-0002', _rev: '1-b', type: 'recipe', code: 'COF-0002', method: 'v60', version: 1, title: 'B', params: {}, steps: [], createdBy: 'manual', createdAt: '2026-04-22T00:00:00Z', updatedAt: '2026-04-22T00:00:00Z' } },
            { id: 'recipe:COF-0003', key: 'recipe:COF-0003', value: { rev: '1-c' }, doc: { _id: 'recipe:COF-0003', _rev: '1-c', type: 'recipe', code: 'COF-0003', method: 'v60', version: 1, title: 'C', params: {}, steps: [], createdBy: 'manual', createdAt: '2026-04-21T00:00:00Z', updatedAt: '2026-04-21T00:00:00Z' } }
          ]
        }
      })
    });
    const recipes = await listRecentRecipes(config, 2, fetchImpl);
    expect(recipes).toHaveLength(2);
    expect(recipes[0].code).toBe('COF-0002'); // newest createdAt
    expect(recipes[1].code).toBe('COF-0003');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @brewdial/web test`
Expected: FAIL — `./recipes` is missing.

- [ ] **Step 3: Implement `apps/web/src/lib/server/repositories/recipes.ts`**

```ts
import type { CreateRecipeInput, RecipeCode, RecipeDoc } from '@brewdial/shared';
import type { CouchConfig } from '../config';
import { getAllDocuments, getDocument, putDocument } from '../couch';
import { nextRecipeCode } from './counters';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function createRecipe(
  config: CouchConfig,
  input: CreateRecipeInput,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc> {
  const code = await nextRecipeCode(config, fetchImpl);
  const now = new Date().toISOString();
  const doc: RecipeDoc = {
    _id: `recipe:${code}`,
    type: 'recipe',
    code,
    method: input.method,
    title: input.title,
    version: 1,
    params: input.params ?? {},
    steps: input.steps ?? [],
    createdBy: input.createdBy ?? 'manual',
    createdAt: now,
    updatedAt: now
  };
  if (input.beanId !== undefined) doc.beanId = input.beanId;
  if (input.beanSnapshot !== undefined) doc.beanSnapshot = input.beanSnapshot;
  if (input.intent !== undefined) doc.intent = input.intent;
  if (input.adjustmentFromPrevious !== undefined)
    doc.adjustmentFromPrevious = input.adjustmentFromPrevious;
  return putDocument(config, doc, fetchImpl);
}

export async function getRecipeByCode(
  config: CouchConfig,
  code: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc | null> {
  return getDocument<RecipeDoc>(config, `recipe:${code}`, fetchImpl);
}

export async function listRecentRecipes(
  config: CouchConfig,
  limit: number = DEFAULT_LIMIT,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const docs = await getAllDocuments<RecipeDoc>(
    config,
    {
      startkey: 'recipe:',
      endkey: 'recipe:￰',
      includeDocs: true
    },
    fetchImpl
  );
  return docs
    .slice()
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, safeLimit);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @brewdial/web test`
Expected: PASS.

- [ ] **Step 5: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/repositories/recipes.ts apps/web/src/lib/server/repositories/recipes.test.ts
git commit -m "feat(web): add recipe repository (create/get/list) on CouchDB"
```

---

## Task 9: Feedback repository (TDD)

**Files:**
- Create: `apps/web/src/lib/server/repositories/feedback.ts`
- Create: `apps/web/src/lib/server/repositories/feedback.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/server/repositories/feedback.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addFeedback, listFeedbackForRecipe } from './feedback';
import { NotFoundError } from '../errors';
import type { CouchConfig } from '../config';

const config: CouchConfig = { url: 'http://127.0.0.1:5984', database: 'coffee' };

interface RouteResult {
  status: number;
  body: unknown;
}

type RouteHandler = (init: RequestInit | undefined, url: URL) => RouteResult;

function makeRouter(routes: Record<string, RouteHandler>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const key = `${init?.method ?? 'GET'} ${decodeURIComponent(u.pathname)}`;
    const handler = routes[key];
    if (!handler) {
      return new Response(`unhandled ${key}`, { status: 500 });
    }
    const result = handler(init, u);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' }
    });
  }) as unknown as typeof fetch;
}

describe('addFeedback', () => {
  it('throws NotFoundError when the recipe does not exist', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/recipe:COF-9999': () => ({ status: 404, body: { error: 'not_found' } })
    });
    await expect(
      addFeedback(
        config,
        { recipeCode: 'COF-9999', ratings: { overall: 4 } },
        fetchImpl
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('stores feedback with feedback:<code>: prefix and recipeId set', async () => {
    const captured: { putBody?: Record<string, unknown>; putPath?: string } = {};
    const fetchImpl = makeRouter({
      'GET /coffee/recipe:COF-0001': () => ({
        status: 200,
        body: {
          _id: 'recipe:COF-0001',
          _rev: '1-r',
          type: 'recipe',
          code: 'COF-0001',
          beanId: 'bean:abc',
          method: 'v60',
          version: 1,
          title: 'X',
          params: {},
          steps: [],
          createdBy: 'manual',
          createdAt: 'now',
          updatedAt: 'now'
        }
      })
    });
    // Catch-all PUT for any feedback id by adding a wildcard handler.
    const wrappedFetch: typeof fetch = (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const path = decodeURIComponent(u.pathname);
      if (init?.method === 'PUT' && path.startsWith('/coffee/feedback:COF-0001:')) {
        captured.putBody = JSON.parse(init.body as string);
        captured.putPath = path;
        return new Response(
          JSON.stringify({ ok: true, id: path.replace('/coffee/', ''), rev: '1-f' }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }
      return fetchImpl(url, init);
    }) as unknown as typeof fetch;

    const feedback = await addFeedback(
      config,
      { recipeCode: 'COF-0001', ratings: { overall: 5, sweetness: 3 } },
      wrappedFetch
    );

    expect(feedback._id.startsWith('feedback:COF-0001:')).toBe(true);
    expect(feedback.recipeId).toBe('recipe:COF-0001');
    expect(feedback.recipeCode).toBe('COF-0001');
    expect(feedback.beanId).toBe('bean:abc');
    expect(feedback.source).toBe('web');
    expect(feedback.createdAt).toBe(feedback.updatedAt);
    expect(captured.putBody?.recipeId).toBe('recipe:COF-0001');
  });
});

describe('listFeedbackForRecipe', () => {
  it('returns feedback docs from _all_docs rows for the recipe prefix', async () => {
    const fetchImpl = makeRouter({
      'GET /coffee/_all_docs': (_init, url) => {
        // Confirm the prefix range targets feedback:COF-0001:
        expect(url.searchParams.get('startkey')).toBe(JSON.stringify('feedback:COF-0001:'));
        expect(url.searchParams.get('endkey')).toBe(JSON.stringify('feedback:COF-0001:￰'));
        expect(url.searchParams.get('include_docs')).toBe('true');
        return {
          status: 200,
          body: {
            total_rows: 2,
            offset: 0,
            rows: [
              { id: 'feedback:COF-0001:a', key: 'feedback:COF-0001:a', value: { rev: '1-a' }, doc: { _id: 'feedback:COF-0001:a', _rev: '1-a', type: 'feedback', recipeCode: 'COF-0001', recipeId: 'recipe:COF-0001', ratings: { overall: 4 }, source: 'web', createdAt: '2026-04-20T00:00:00Z', updatedAt: '2026-04-20T00:00:00Z' } },
              { id: 'feedback:COF-0001:b', key: 'feedback:COF-0001:b', value: { rev: '1-b' }, doc: { _id: 'feedback:COF-0001:b', _rev: '1-b', type: 'feedback', recipeCode: 'COF-0001', recipeId: 'recipe:COF-0001', ratings: { overall: 5 }, source: 'web', createdAt: '2026-04-21T00:00:00Z', updatedAt: '2026-04-21T00:00:00Z' } }
            ]
          }
        };
      }
    });
    const items = await listFeedbackForRecipe(config, 'COF-0001', fetchImpl);
    expect(items.map((f) => f._id)).toEqual([
      'feedback:COF-0001:a',
      'feedback:COF-0001:b'
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @brewdial/web test`
Expected: FAIL — `./feedback` is missing.

- [ ] **Step 3: Implement `apps/web/src/lib/server/repositories/feedback.ts`**

```ts
import type { CreateFeedbackInput, FeedbackDoc, RecipeCode } from '@brewdial/shared';
import type { CouchConfig } from '../config';
import { getAllDocuments, putDocument } from '../couch';
import { NotFoundError } from '../errors';
import { getRecipeByCode } from './recipes';

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function addFeedback(
  config: CouchConfig,
  input: CreateFeedbackInput,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackDoc> {
  const recipe = await getRecipeByCode(config, input.recipeCode, fetchImpl);
  if (!recipe) {
    throw new NotFoundError(`Recipe ${input.recipeCode} not found`);
  }

  const now = new Date().toISOString();
  const id = `feedback:${input.recipeCode}:${now}-${randomSuffix()}`;
  const doc: FeedbackDoc = {
    _id: id,
    type: 'feedback',
    recipeCode: input.recipeCode,
    recipeId: `recipe:${input.recipeCode}`,
    ratings: input.ratings,
    source: input.source ?? 'web',
    createdAt: now,
    updatedAt: now
  };
  if (recipe.beanId !== undefined) doc.beanId = recipe.beanId;
  if (input.actual !== undefined) doc.actual = input.actual;
  if (input.comment !== undefined) doc.comment = input.comment;
  if (input.desiredDirection !== undefined) doc.desiredDirection = input.desiredDirection;
  if (input.nextHint !== undefined) doc.nextHint = input.nextHint;

  return putDocument(config, doc, fetchImpl);
}

export async function listFeedbackForRecipe(
  config: CouchConfig,
  recipeCode: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackDoc[]> {
  const docs = await getAllDocuments<FeedbackDoc>(
    config,
    {
      startkey: `feedback:${recipeCode}:`,
      endkey: `feedback:${recipeCode}:￰`,
      includeDocs: true
    },
    fetchImpl
  );
  return docs
    .slice()
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @brewdial/web test`
Expected: PASS.

- [ ] **Step 5: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/repositories/feedback.ts apps/web/src/lib/server/repositories/feedback.test.ts
git commit -m "feat(web): add feedback repository with recipe existence check"
```

---

## Task 10: `GET /api/recipes` and `POST /api/recipes`

**Files:**
- Create: `apps/web/src/routes/api/recipes/+server.ts`

- [ ] **Step 1: Create the route handler**

```ts
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  validateCreateRecipeInput,
  type ApiErrorResponse,
  type CreateRecipeResponse,
  type ListRecipesResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import {
  createRecipe,
  listRecentRecipes
} from '$lib/server/repositories/recipes';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

function couchUnreachable(): Response {
  const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
  return json(body, { status: 503 });
}

export const GET = async ({ url }: { url: URL }) => {
  const config = getServerConfig(env);
  const limit = clampLimit(url.searchParams.get('limit'));
  try {
    const recipes = await listRecentRecipes(config.couch, limit);
    const body: ListRecipesResponse = { recipes };
    return json(body);
  } catch {
    return couchUnreachable();
  }
};

export const POST = async ({ request }: { request: Request }) => {
  const config = getServerConfig(env);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    const body: ApiErrorResponse = { ok: false, error: 'Invalid JSON body' };
    return json(body, { status: 400 });
  }
  const result = validateCreateRecipeInput(payload);
  if (!result.ok) {
    const body: ApiErrorResponse = {
      ok: false,
      error: 'Invalid recipe input',
      details: result.errors
    };
    return json(body, { status: 400 });
  }
  try {
    const recipe = await createRecipe(config.couch, result.value);
    const body: CreateRecipeResponse = { recipe };
    return json(body, { status: 201 });
  } catch {
    return couchUnreachable();
  }
};
```

- [ ] **Step 2: Run check + test**

Run: `pnpm check && pnpm test`
Expected: PASS — no new failures.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/api/recipes/+server.ts
git commit -m "feat(web): add GET/POST /api/recipes JSON routes"
```

---

## Task 11: `GET /api/recipes/[code]`

**Files:**
- Create: `apps/web/src/routes/api/recipes/[code]/+server.ts`

- [ ] **Step 1: Create the route handler**

```ts
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  isRecipeCode,
  type ApiErrorResponse,
  type GetRecipeResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { getRecipeByCode } from '$lib/server/repositories/recipes';

export const GET = async ({ params }: { params: { code: string } }) => {
  const config = getServerConfig(env);
  const code = params.code;
  if (!isRecipeCode(code)) {
    const body: ApiErrorResponse = { ok: false, error: 'Invalid recipe code' };
    return json(body, { status: 400 });
  }
  try {
    const recipe = await getRecipeByCode(config.couch, code);
    if (!recipe) {
      const body: ApiErrorResponse = { ok: false, error: 'Recipe not found' };
      return json(body, { status: 404 });
    }
    const body: GetRecipeResponse = { recipe };
    return json(body);
  } catch {
    const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
    return json(body, { status: 503 });
  }
};
```

- [ ] **Step 2: Run check + test**

Run: `pnpm check && pnpm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/api/recipes/[code]/+server.ts
git commit -m "feat(web): add GET /api/recipes/[code] JSON route"
```

---

## Task 12: `GET` and `POST` `/api/feedback`

**Files:**
- Create: `apps/web/src/routes/api/feedback/+server.ts`

- [ ] **Step 1: Create the route handler**

```ts
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  isRecipeCode,
  validateCreateFeedbackInput,
  type ApiErrorResponse,
  type CreateFeedbackResponse,
  type ListFeedbackResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { NotFoundError } from '$lib/server/errors';
import {
  addFeedback,
  listFeedbackForRecipe
} from '$lib/server/repositories/feedback';

function couchUnreachable(): Response {
  const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
  return json(body, { status: 503 });
}

export const GET = async ({ url }: { url: URL }) => {
  const config = getServerConfig(env);
  const recipeCode = url.searchParams.get('recipeCode');
  if (!recipeCode) {
    const body: ApiErrorResponse = {
      ok: false,
      error: 'recipeCode query parameter is required'
    };
    return json(body, { status: 400 });
  }
  if (!isRecipeCode(recipeCode)) {
    const body: ApiErrorResponse = {
      ok: false,
      error: 'recipeCode must match COF-NNNN'
    };
    return json(body, { status: 400 });
  }
  try {
    const feedback = await listFeedbackForRecipe(config.couch, recipeCode);
    const body: ListFeedbackResponse = { feedback };
    return json(body);
  } catch {
    return couchUnreachable();
  }
};

export const POST = async ({ request }: { request: Request }) => {
  const config = getServerConfig(env);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    const body: ApiErrorResponse = { ok: false, error: 'Invalid JSON body' };
    return json(body, { status: 400 });
  }
  const result = validateCreateFeedbackInput(payload);
  if (!result.ok) {
    const body: ApiErrorResponse = {
      ok: false,
      error: 'Invalid feedback input',
      details: result.errors
    };
    return json(body, { status: 400 });
  }
  try {
    const feedback = await addFeedback(config.couch, result.value);
    const body: CreateFeedbackResponse = { feedback };
    return json(body, { status: 201 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      const body: ApiErrorResponse = { ok: false, error: err.message };
      return json(body, { status: 404 });
    }
    return couchUnreachable();
  }
};
```

- [ ] **Step 2: Run check + test + build**

Run: `pnpm check && pnpm test && pnpm build`
Expected: all PASS. `pnpm build` is the meaningful check that all SvelteKit routes compile.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/api/feedback/+server.ts
git commit -m "feat(web): add GET/POST /api/feedback JSON routes"
```

---

## Task 13: README + ADR docs

**Files:**
- Modify: `README.md`
- Create: `docs/decisions/0003-recipe-feedback-api.md`

- [ ] **Step 1: Append a `## Recipe / Feedback API` section to `README.md`**

Insert this section just above the existing `## License` heading in `README.md`:

```markdown
## Recipe / Feedback API

PR4 adds the JSON API for recipes and feedback. All endpoints require CouchDB to
be running and bootstrapped (`pnpm db:bootstrap`).

```bash
# Create a recipe
curl -X POST http://localhost:5173/api/recipes \
  -H 'content-type: application/json' \
  -d '{
    "method": "v60",
    "title": "Test V60",
    "params": { "doseG": 15, "waterG": 240, "tempC": 92 },
    "steps": [{ "atSec": 0, "waterG": 40, "note": "Bloom" }]
  }'

# List recipes (newest first, default limit 20, max 100)
curl http://localhost:5173/api/recipes
curl 'http://localhost:5173/api/recipes?limit=5'

# Get one recipe by code
curl http://localhost:5173/api/recipes/COF-0001

# Add feedback for a recipe
curl -X POST http://localhost:5173/api/feedback \
  -H 'content-type: application/json' \
  -d '{
    "recipeCode": "COF-0001",
    "ratings": { "overall": 4, "sweetness": 3, "burnt": 1 },
    "comment": "Sweetness was good; no burnt taste."
  }'

# List feedback for a recipe
curl 'http://localhost:5173/api/feedback?recipeCode=COF-0001'
```

Recipe codes are minted by a CouchDB counter document (`counter:recipe`) and
formatted as `COF-NNNN` (zero-padded to 4 digits). Feedback document IDs are of
the form `feedback:<recipeCode>:<timestamp-suffix>`. CouchDB credentials are
never echoed in API responses or logs.
```

(The triple-backticks above are the actual fenced blocks in the README. Make sure the outer fence closes the section cleanly when you paste it in.)

- [ ] **Step 2: Create `docs/decisions/0003-recipe-feedback-api.md`**

```markdown
# 0003 — Recipe / Feedback API Foundation

## Status

Accepted (PR4, Recipe / Feedback API).

## Context

PR3 landed the CouchDB foundation: server-only config loader, fetch-based
client, DB health endpoint, bootstrap script, and a global preferences
repository. PR4 needs to add the first real read/write surface — recipes and
feedback — without committing to a UI, agent context API, or MCP server yet.

## Decision

### Why the API foundation comes before the mobile UI

- A stable, agent-agnostic JSON surface unblocks both the future mobile UI and
  the future MCP server in parallel.
- Repositories + routes are testable today against mocked `fetch`; a UI built
  on top of a churning API would mostly serve to document the churn.
- It keeps the public contract (`CreateRecipeInput`, `CreateFeedbackInput`,
  response shapes) reviewable in isolation before any client locks in
  assumptions.

### Why manual validation instead of `zod` for PR4

- The validation surface is small (two creators) and the schemas are visible
  beside the type definitions in `@brewdial/shared`.
- Adding `zod` (or any runtime validator) costs an audit, version drift, and
  ~30KB of bundle weight that the agent path doesn't need yet.
- Hand-written helpers force us to keep the data contract narrow — every
  accepted field has to be named explicitly, which makes "permissive top-level,
  copy known fields only" the natural shape.
- If validation grows beyond what's reviewable in one file, switching to `zod`
  is a localized refactor inside `packages/shared/src/validation.ts`.

### Why `_all_docs` prefix ranges instead of Mango indexes for PR4

- `_all_docs` is always available, requires zero index management, and is fast
  enough at MVP scale (single MacBook, dozens to hundreds of docs).
- Document IDs already encode the natural prefix (`recipe:COF-…`,
  `feedback:COF-NNNN:…`), so prefix ranges express the queries we actually need
  without designing a secondary index.
- Mango indexes need a `_design` doc plus a migration story; deferring that to
  the first query that genuinely needs it keeps PR4 small.

### Why recipe codes use `counter:recipe`

- A single CouchDB document is the simplest source of truth for "the next
  recipe number" — no UUIDs to humanize, no separate sequence service.
- `_rev`-based optimistic concurrency is built in; we retry on 409 a small
  number of times rather than introducing an explicit lock.
- Codes (`COF-0001`) stay short, human-quotable, and stable across sync
  scenarios (PouchDB later) because they're embedded in the document ID.

## Non-goals (PR4)

- No mobile UI.
- No agent context summary API.
- No MCP server.
- No auth / sessions / rate limiting.
- No PouchDB / offline sync.
- No `zod` or other runtime validation library.
- No CouchDB SDK.
- No Mango indexes or `_design` docs.
```

- [ ] **Step 3: Run check + test + build**

Run: `pnpm check && pnpm test && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/decisions/0003-recipe-feedback-api.md
git commit -m "docs: document recipe/feedback API and add ADR 0003"
```

---

## Task 14: Final validation + (optional) live smoke test

**Files:** none

- [ ] **Step 1: Install + full validation gauntlet**

```bash
pnpm install
pnpm check
pnpm build
pnpm test
pnpm lint
```

Expected: every command exits 0. (`pnpm lint` is a no-op stub that prints a message and exits 0 — that's fine.)

- [ ] **Step 2: Optional — live CouchDB smoke test (only if local CouchDB is running)**

Skip this step if `pnpm db:health` reports unreachable; record the skip in the PR description.

```bash
pnpm db:bootstrap
pnpm dev &
DEV_PID=$!
# wait a couple of seconds for SvelteKit to come up before curling
sleep 3

curl -sS http://localhost:5173/api/db/health | head -c 400; echo
curl -sS -X POST http://localhost:5173/api/recipes \
  -H 'content-type: application/json' \
  -d '{"method":"v60","title":"Smoke Test V60"}' | head -c 400; echo
curl -sS http://localhost:5173/api/recipes | head -c 400; echo
curl -sS http://localhost:5173/api/recipes/COF-0001 | head -c 400; echo
curl -sS -X POST http://localhost:5173/api/feedback \
  -H 'content-type: application/json' \
  -d '{"recipeCode":"COF-0001","ratings":{"overall":4,"sweetness":3}}' | head -c 400; echo
curl -sS 'http://localhost:5173/api/feedback?recipeCode=COF-0001' | head -c 400; echo

kill $DEV_PID
```

Expected: every response is a JSON document, the `POST /api/recipes` returns a `recipe.code` like `COF-0001`, and the second `GET /api/recipes/COF-0001` returns the same recipe.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/recipe-feedback-api
```

- [ ] **Step 4: Open the pull request**

Create a PR against `main` titled `feat: add recipe and feedback api` with this body (replace the live-smoke checkbox with whatever you actually ran):

```markdown
## Summary
- Added recipe/feedback API input and response types
- Added runtime validation helpers for create recipe/feedback payloads
- Added CouchDB counter-backed recipe code generation
- Added recipe and feedback repository helpers
- Added JSON API routes for recipes and feedback
- Added repository/validation test coverage
- Documented Recipe / Feedback API in README and ADR 0003

## Validation
- [x] pnpm install
- [x] pnpm check
- [x] pnpm build
- [x] pnpm test
- [x] pnpm lint
- [ ] live CouchDB smoke test, if local CouchDB available

## Notes
- Mobile UI intentionally deferred
- Agent context summary API intentionally deferred
- MCP server intentionally deferred
- Auth intentionally deferred
```
