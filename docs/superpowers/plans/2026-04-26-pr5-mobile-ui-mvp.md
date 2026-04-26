# PR5 — Mobile UI MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-first SvelteKit web UI for humans on top of the existing PR4 Recipe / Feedback API — app shell, dashboard, recipe list, recipe detail (with feedback history), recipe creation form, feedback creation form, plus pure form-helper modules with Vitest coverage. Land as PR `feat/mobile-ui-mvp` against `main` on `git@github.com:mgh3326/brewdial`.

**Architecture:** SvelteKit `+page.server.ts` `load` functions and form `actions` call existing repository helpers in `apps/web/src/lib/server/repositories/` directly (no self-fetch to local API). Pages render via Svelte 5 runes (`$props`) with plain CSS only. Form `FormData` flows through pure helpers in `apps/web/src/lib/forms/` that produce `CreateRecipeInput` / `CreateFeedbackInput`-shaped objects, then get re-validated via existing `validateCreate*Input` helpers from `@brewdial/shared` before hitting the repository. UI primitives (`RecipeCard`, `ErrorPanel`, `RatingControl`) live in `apps/web/src/lib/ui/`.

**Tech Stack:** pnpm@10.33.2, Node ≥22, TypeScript, SvelteKit 2.57, Svelte 5.55 (runes), plain CSS, CouchDB via existing `fetch`-based client, Vitest 3.

**Reference spec / source prompt:** `~/shared/prompts/brewdial-pr5-mobile-ui-mvp.md` (passed in by the user; not committed under `docs/superpowers/specs/`).

---

## Pre-flight

Run from the worktree root (`/Users/robin/.superset/worktrees/brewdial/ui-mvp`, the current working directory). Confirm:

- `pnpm --version` reports `10.33.2`
- `node --version` reports `>=22`
- `git remote -v` shows `git@github.com:mgh3326/brewdial`
- Latest `main` includes PR4 (`Merge pull request #4 from mgh3326/feat/recipe-feedback-api`)
- Working tree clean

Branch note: this worktree already lives on the local branch `ui-mvp` (created from `main` after PR4). The source prompt suggests `feat/mobile-ui-mvp`. Either branch name is acceptable — the PR description is what matters. **Task 1** keeps the existing `ui-mvp` branch and just verifies state; do **not** delete or rename branches.

---

## File map

| Path | Action | Owner Task |
| --- | --- | --- |
| `apps/web/src/app.css` | modify (mobile-first stylesheet) | T2 |
| `apps/web/src/routes/+layout.svelte` | modify (app shell + nav) | T3 |
| `apps/web/src/lib/ui/ErrorPanel.svelte` | create | T4 |
| `apps/web/src/lib/ui/RecipeCard.svelte` | create | T5 |
| `apps/web/src/lib/ui/RatingControl.svelte` | create | T6 |
| `apps/web/src/lib/forms/recipe-form.ts` | create | T7 |
| `apps/web/src/lib/forms/recipe-form.test.ts` | create | T7 |
| `apps/web/src/lib/forms/feedback-form.ts` | create | T8 |
| `apps/web/src/lib/forms/feedback-form.test.ts` | create | T8 |
| `apps/web/src/routes/+page.server.ts` | create | T9 |
| `apps/web/src/routes/+page.svelte` | modify (replace placeholder) | T9 |
| `apps/web/src/routes/recipes/+page.server.ts` | create | T10 |
| `apps/web/src/routes/recipes/+page.svelte` | create | T10 |
| `apps/web/src/routes/recipes/new/+page.server.ts` | create | T11 |
| `apps/web/src/routes/recipes/new/+page.svelte` | create | T11 |
| `apps/web/src/routes/recipes/[code]/+page.server.ts` | create | T12 |
| `apps/web/src/routes/recipes/[code]/+page.svelte` | create | T12 |
| `apps/web/src/routes/feedback/new/+page.server.ts` | create | T13 |
| `apps/web/src/routes/feedback/new/+page.svelte` | create | T13 |
| `README.md` | modify (add Mobile UI MVP section) | T14 |
| `docs/decisions/0004-mobile-ui-mvp.md` | create | T14 |

---

## Task 1: Verify branch state

**Files:** none

- [ ] **Step 1: Confirm clean working tree, on `ui-mvp`, with PR4 merged into `main`**

Run:

```bash
git status --short --branch
git log --oneline -3
```

Expected `git status` line: `## ui-mvp`. Expected `git log` top line includes `Merge pull request #4 from mgh3326/feat/recipe-feedback-api`.

If output differs, stop and resolve before continuing.

- [ ] **Step 2: Confirm tooling versions**

```bash
pnpm --version
node --version
```

Expected: `10.33.2` and `>=22`.

- [ ] **Step 3: Install workspace deps (idempotent)**

```bash
pnpm install
```

Expected: completes without errors; lockfile unchanged or updated by lockfile lifecycle only.

---

## Task 2: Mobile-first stylesheet

**Files:**
- Modify: `apps/web/src/app.css`

- [ ] **Step 1: Replace the current minimal stylesheet with mobile-first styles**

Overwrite `apps/web/src/app.css` with the following content. Plain CSS only — no Tailwind, no preprocessors.

```css
:root {
  --bg: #fafafa;
  --surface: #ffffff;
  --surface-muted: #f1ece6;
  --text: #1a1a1a;
  --text-muted: #555;
  --accent: #6f4e37;
  --accent-strong: #4a321f;
  --danger-bg: #fdecea;
  --danger-border: #e0b4b4;
  --danger-text: #7a1f1f;
  --border: #e6e1da;
  --radius: 0.5rem;
  --container: 720px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  -webkit-text-size-adjust: 100%;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}

a {
  color: var(--accent);
}

a:hover {
  color: var(--accent-strong);
}

.app-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1rem;
  position: sticky;
  top: 0;
  z-index: 1;
}

.app-header-inner {
  max-width: var(--container);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.app-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
  color: var(--accent-strong);
  text-decoration: none;
}

.app-nav {
  display: flex;
  gap: 1rem;
  font-size: 0.95rem;
}

.app-nav a {
  text-decoration: none;
}

.app-main {
  max-width: var(--container);
  margin: 0 auto;
  padding: 1rem 1rem 4rem;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.stack-tight {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.muted {
  color: var(--text-muted);
}

.code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  background: var(--surface-muted);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.btn {
  display: inline-block;
  padding: 0.625rem 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  font-size: 1rem;
  text-decoration: none;
  cursor: pointer;
  min-height: 2.75rem;
}

.btn:hover {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: #fff;
}

.btn-secondary {
  background: var(--surface);
  color: var(--accent);
}

.btn-secondary:hover {
  background: var(--surface-muted);
  color: var(--accent-strong);
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  text-decoration: none;
  color: inherit;
}

.card:hover {
  border-color: var(--accent);
}

.card-title {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
}

.card-meta {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.error-panel {
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
  color: var(--danger-text);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field label {
  font-weight: 600;
  font-size: 0.95rem;
}

.field input,
.field select,
.field textarea {
  font: inherit;
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  min-height: 2.5rem;
}

.field textarea {
  min-height: 6rem;
  resize: vertical;
}

.rating {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.rating-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.rating-options label {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
  min-height: 2.25rem;
  min-width: 2.5rem;
  justify-content: center;
}

.rating-options input[type="radio"] {
  accent-color: var(--accent);
}

.rating-options input[type="radio"]:checked + span {
  font-weight: 700;
}

.dl {
  display: grid;
  grid-template-columns: minmax(7rem, max-content) 1fr;
  gap: 0.25rem 0.75rem;
  margin: 0;
}

.dl dt {
  color: var(--text-muted);
}

.dl dd {
  margin: 0;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161616;
    --surface: #1f1f1f;
    --surface-muted: #2a2520;
    --text: #e8e8e8;
    --text-muted: #aaa;
    --accent: #d4a574;
    --accent-strong: #f0c89a;
    --danger-bg: #3a1f1f;
    --danger-border: #6b3a3a;
    --danger-text: #f5b8b8;
    --border: #2e2a26;
  }

  .btn {
    color: #1a1a1a;
  }

  .btn:hover {
    color: #1a1a1a;
  }
}
```

- [ ] **Step 2: Sanity check `pnpm check` still passes (no Svelte type changes yet)**

```bash
pnpm check
```

Expected: zero errors and zero warnings.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app.css
git commit -m "feat(web): mobile-first stylesheet for ui mvp"
```

---

## Task 3: App-shell layout

**Files:**
- Modify: `apps/web/src/routes/+layout.svelte`

- [ ] **Step 1: Replace the layout with a header + nav + main shell**

Overwrite `apps/web/src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<header class="app-header">
  <div class="app-header-inner">
    <a class="app-title" href="/">BrewDial</a>
    <nav class="app-nav" aria-label="Primary">
      <a href="/">Home</a>
      <a href="/recipes">Recipes</a>
      <a href="/recipes/new">New recipe</a>
    </nav>
  </div>
</header>

<main class="app-main">
  {@render children()}
</main>
```

Do not add auth UI, user menu, theme toggle, or footer in this PR.

- [ ] **Step 2: Verify `pnpm check`**

```bash
pnpm check
```

Expected: zero errors, zero warnings.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/+layout.svelte
git commit -m "feat(web): app shell with header and primary nav"
```

---

## Task 4: `ErrorPanel` component

**Files:**
- Create: `apps/web/src/lib/ui/ErrorPanel.svelte`

- [ ] **Step 1: Create the component**

Write `apps/web/src/lib/ui/ErrorPanel.svelte`:

```svelte
<script lang="ts">
  interface Props {
    message: string;
  }
  let { message }: Props = $props();
</script>

<div class="error-panel" role="alert">
  {message}
</div>
```

- [ ] **Step 2: `pnpm check`**

```bash
pnpm check
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/ui/ErrorPanel.svelte
git commit -m "feat(web): add ErrorPanel ui component"
```

---

## Task 5: `RecipeCard` component

**Files:**
- Create: `apps/web/src/lib/ui/RecipeCard.svelte`

- [ ] **Step 1: Create the component**

Write `apps/web/src/lib/ui/RecipeCard.svelte`:

```svelte
<script lang="ts">
  import type { RecipeDoc } from '@brewdial/shared';

  interface Props {
    recipe: RecipeDoc;
  }
  let { recipe }: Props = $props();

  function formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  }
</script>

<a class="card" href={`/recipes/${recipe.code}`}>
  <p class="card-meta">
    <span class="code">{recipe.code}</span>
    <span class="muted"> · {recipe.method}</span>
  </p>
  <h3 class="card-title">{recipe.title}</h3>
  {#if recipe.beanSnapshot?.name || recipe.beanSnapshot?.roaster}
    <p class="card-meta">
      {[recipe.beanSnapshot?.name, recipe.beanSnapshot?.roaster].filter(Boolean).join(' · ')}
    </p>
  {/if}
  <p class="card-meta muted">{formatDate(recipe.createdAt)}</p>
</a>
```

- [ ] **Step 2: `pnpm check`**

```bash
pnpm check
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/ui/RecipeCard.svelte
git commit -m "feat(web): add RecipeCard ui component"
```

---

## Task 6: `RatingControl` component

**Files:**
- Create: `apps/web/src/lib/ui/RatingControl.svelte`

- [ ] **Step 1: Create the component**

Write `apps/web/src/lib/ui/RatingControl.svelte`:

```svelte
<script lang="ts">
  interface Props {
    name: string;
    label: string;
    min?: number;
    max?: number;
    value?: string;
  }
  let { name, label, min = 0, max = 4, value = undefined }: Props = $props();

  const options = Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
</script>

<fieldset class="rating">
  <legend>{label}</legend>
  <div class="rating-options" role="radiogroup" aria-label={label}>
    {#each options as option}
      <label>
        <input
          type="radio"
          {name}
          value={option}
          checked={value === option}
        />
        <span>{option}</span>
      </label>
    {/each}
  </div>
</fieldset>
```

Notes:
- `name` matches the form field key (`overall`, `sweetness`, etc.).
- For `overall` use `min=1 max=5`. For sensory ratings use defaults (`0..4`).
- Radio groups allow leaving a rating blank by simply not selecting any option.

- [ ] **Step 2: `pnpm check`**

```bash
pnpm check
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/ui/RatingControl.svelte
git commit -m "feat(web): add RatingControl ui component"
```

---

## Task 7: `recipe-form` helper module + tests (TDD)

**Files:**
- Create: `apps/web/src/lib/forms/recipe-form.ts`
- Test: `apps/web/src/lib/forms/recipe-form.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `apps/web/src/lib/forms/recipe-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  formDataToRecipeValues,
  recipeValuesToInput,
  type RecipeFormValues
} from './recipe-form';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe('formDataToRecipeValues', () => {
  it('extracts and trims provided fields, omits blanks', () => {
    const values = formDataToRecipeValues(
      fd({
        title: '  Test V60  ',
        method: 'v60',
        beanName: 'Yirgacheffe ',
        roaster: '',
        roastDate: '2026-04-01',
        doseG: ' 15 ',
        waterG: '240',
        tempC: '',
        grind: 'medium-fine',
        targetTimeSec: '180',
        intentText: 'sweeter\nless burnt\n',
        stepsText: 'Bloom 40g for 35s\nPour to 160g\n'
      })
    );
    expect(values).toEqual({
      title: 'Test V60',
      method: 'v60',
      beanName: 'Yirgacheffe',
      roastDate: '2026-04-01',
      doseG: '15',
      waterG: '240',
      grind: 'medium-fine',
      targetTimeSec: '180',
      intentText: 'sweeter\nless burnt\n',
      stepsText: 'Bloom 40g for 35s\nPour to 160g\n'
    });
  });
});

describe('recipeValuesToInput', () => {
  it('converts required fields and omits empty optionals', () => {
    const values: RecipeFormValues = { title: 'Test V60', method: 'v60' };
    const input = recipeValuesToInput(values);
    expect(input).toEqual({ method: 'v60', title: 'Test V60' });
  });

  it('parses numeric params and includes them when provided', () => {
    const values: RecipeFormValues = {
      title: 'Test V60',
      method: 'v60',
      doseG: '15',
      waterG: '240',
      tempC: '92',
      grind: 'medium-fine',
      targetTimeSec: '180'
    };
    const input = recipeValuesToInput(values);
    expect(input).toEqual({
      method: 'v60',
      title: 'Test V60',
      params: { doseG: 15, waterG: 240, tempC: 92, grind: 'medium-fine', targetTimeSec: 180 }
    });
  });

  it('builds beanSnapshot only when at least one bean field is present', () => {
    const a = recipeValuesToInput({ title: 'a', method: 'v60' });
    expect(a.beanSnapshot).toBeUndefined();

    const b = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      beanName: 'Yirg',
      roastDate: '2026-04-01'
    });
    expect(b.beanSnapshot).toEqual({ name: 'Yirg', roastDate: '2026-04-01' });
  });

  it('converts intentText into a string array of non-empty trimmed lines', () => {
    const input = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      intentText: 'sweeter\n\n  less burnt  \n'
    });
    expect(input.intent).toEqual(['sweeter', 'less burnt']);
  });

  it('converts stepsText into note-only steps from non-empty trimmed lines', () => {
    const input = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      stepsText: 'Bloom 40g for 35s\n\n  Pour to 160g \n'
    });
    expect(input.steps).toEqual([{ note: 'Bloom 40g for 35s' }, { note: 'Pour to 160g' }]);
  });

  it('skips numeric params that are not finite numbers', () => {
    const input = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      doseG: 'not-a-number',
      waterG: '   '
    });
    expect(input.params).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/forms/recipe-form.test.ts
```

Expected: failure — `Cannot find module './recipe-form'`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/src/lib/forms/recipe-form.ts`:

```ts
import type { CreateRecipeInput } from '@brewdial/shared';

export interface RecipeFormValues {
  title?: string;
  method?: string;
  beanName?: string;
  roaster?: string;
  roastDate?: string;
  doseG?: string;
  waterG?: string;
  tempC?: string;
  grind?: string;
  targetTimeSec?: string;
  intentText?: string;
  stepsText?: string;
}

const STRING_KEYS: ReadonlyArray<keyof RecipeFormValues> = [
  'title',
  'method',
  'beanName',
  'roaster',
  'roastDate',
  'doseG',
  'waterG',
  'tempC',
  'grind',
  'targetTimeSec'
];

const RAW_TEXT_KEYS: ReadonlyArray<keyof RecipeFormValues> = ['intentText', 'stepsText'];

function readTrimmed(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readRaw(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  return raw.trim().length === 0 ? undefined : raw;
}

export function formDataToRecipeValues(formData: FormData): RecipeFormValues {
  const out: RecipeFormValues = {};
  for (const key of STRING_KEYS) {
    const v = readTrimmed(formData, key);
    if (v !== undefined) (out as Record<string, string>)[key] = v;
  }
  for (const key of RAW_TEXT_KEYS) {
    const v = readRaw(formData, key);
    if (v !== undefined) (out as Record<string, string>)[key] = v;
  }
  return out;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function linesToArray(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function recipeValuesToInput(values: RecipeFormValues): CreateRecipeInput {
  const input: CreateRecipeInput = {
    method: (values.method ?? '') as CreateRecipeInput['method'],
    title: values.title ?? ''
  };

  const beanSnapshot: NonNullable<CreateRecipeInput['beanSnapshot']> = {};
  if (values.beanName) beanSnapshot.name = values.beanName;
  if (values.roaster) beanSnapshot.roaster = values.roaster;
  if (values.roastDate) beanSnapshot.roastDate = values.roastDate;
  if (Object.keys(beanSnapshot).length > 0) input.beanSnapshot = beanSnapshot;

  const params: NonNullable<CreateRecipeInput['params']> = {};
  const doseG = parseNumber(values.doseG);
  const waterG = parseNumber(values.waterG);
  const tempC = parseNumber(values.tempC);
  const targetTimeSec = parseNumber(values.targetTimeSec);
  if (doseG !== undefined) params.doseG = doseG;
  if (waterG !== undefined) params.waterG = waterG;
  if (tempC !== undefined) params.tempC = tempC;
  if (targetTimeSec !== undefined) params.targetTimeSec = targetTimeSec;
  if (values.grind) params.grind = values.grind;
  if (Object.keys(params).length > 0) input.params = params;

  const intent = linesToArray(values.intentText);
  if (intent.length > 0) input.intent = intent;

  const stepNotes = linesToArray(values.stepsText);
  if (stepNotes.length > 0) input.steps = stepNotes.map((note) => ({ note }));

  return input;
}
```

- [ ] **Step 4: Run the tests; confirm they pass**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/forms/recipe-form.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run the full test suite as a regression check**

```bash
pnpm test
```

Expected: all existing repository / shared / API tests still pass alongside the new ones.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/forms/recipe-form.ts apps/web/src/lib/forms/recipe-form.test.ts
git commit -m "feat(web): add recipe-form helper with vitest coverage"
```

---

## Task 8: `feedback-form` helper module + tests (TDD)

**Files:**
- Create: `apps/web/src/lib/forms/feedback-form.ts`
- Test: `apps/web/src/lib/forms/feedback-form.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `apps/web/src/lib/forms/feedback-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  feedbackValuesToInput,
  formDataToFeedbackValues,
  type FeedbackFormValues
} from './feedback-form';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe('formDataToFeedbackValues', () => {
  it('extracts and trims provided fields, omits blanks', () => {
    const values = formDataToFeedbackValues(
      fd({
        recipeCode: 'COF-0001',
        overall: '4',
        sweetness: '3',
        burnt: '1',
        bitter: '',
        comment: '  tasted balanced  ',
        desiredDirectionText: 'sweeter\nless burnt\n',
        tempC: '92',
        grind: 'medium-fine',
        timeSec: '180'
      })
    );
    expect(values).toEqual({
      recipeCode: 'COF-0001',
      overall: '4',
      sweetness: '3',
      burnt: '1',
      comment: 'tasted balanced',
      desiredDirectionText: 'sweeter\nless burnt\n',
      tempC: '92',
      grind: 'medium-fine',
      timeSec: '180'
    });
  });
});

describe('feedbackValuesToInput', () => {
  it('builds ratings only from provided rating fields', () => {
    const values: FeedbackFormValues = {
      recipeCode: 'COF-0001',
      overall: '4',
      sweetness: '3',
      burnt: '1'
    };
    const input = feedbackValuesToInput(values);
    expect(input).toEqual({
      recipeCode: 'COF-0001',
      ratings: { overall: 4, sweetness: 3, burnt: 1 }
    });
  });

  it('omits ratings keys that are blank or non-numeric', () => {
    const values: FeedbackFormValues = {
      recipeCode: 'COF-0001',
      overall: '',
      sweetness: '3',
      bitter: 'x'
    };
    const input = feedbackValuesToInput(values);
    expect(input.ratings).toEqual({ sweetness: 3 });
    expect('overall' in input.ratings).toBe(false);
    expect('bitter' in input.ratings).toBe(false);
  });

  it('converts desiredDirectionText into a string array of non-empty trimmed lines', () => {
    const input = feedbackValuesToInput({
      recipeCode: 'COF-0001',
      overall: '4',
      desiredDirectionText: 'sweeter\n\n  less burnt  \n'
    });
    expect(input.desiredDirection).toEqual(['sweeter', 'less burnt']);
  });

  it('builds actual only when at least one actual field is present', () => {
    const a = feedbackValuesToInput({ recipeCode: 'COF-0001', overall: '4' });
    expect(a.actual).toBeUndefined();

    const b = feedbackValuesToInput({
      recipeCode: 'COF-0001',
      overall: '4',
      tempC: '92',
      grind: 'medium-fine',
      timeSec: '180'
    });
    expect(b.actual).toEqual({ tempC: 92, grind: 'medium-fine', timeSec: 180 });
  });

  it('omits source so the repository default applies', () => {
    const input = feedbackValuesToInput({ recipeCode: 'COF-0001', overall: '4' });
    expect('source' in input).toBe(false);
  });

  it('passes through comment when present', () => {
    const input = feedbackValuesToInput({
      recipeCode: 'COF-0001',
      overall: '4',
      comment: 'tasted balanced'
    });
    expect(input.comment).toBe('tasted balanced');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/forms/feedback-form.test.ts
```

Expected: failure — `Cannot find module './feedback-form'`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/src/lib/forms/feedback-form.ts`:

```ts
import type { CreateFeedbackInput, FeedbackRatings } from '@brewdial/shared';

export interface FeedbackFormValues {
  recipeCode?: string;
  overall?: string;
  sweetness?: string;
  burnt?: string;
  bitter?: string;
  sour?: string;
  body?: string;
  astringency?: string;
  clarity?: string;
  comment?: string;
  desiredDirectionText?: string;
  tempC?: string;
  grind?: string;
  timeSec?: string;
}

const RATING_KEYS: ReadonlyArray<keyof FeedbackRatings> = [
  'overall',
  'sweetness',
  'burnt',
  'bitter',
  'sour',
  'body',
  'astringency',
  'clarity'
];

const STRING_KEYS: ReadonlyArray<keyof FeedbackFormValues> = [
  'recipeCode',
  'overall',
  'sweetness',
  'burnt',
  'bitter',
  'sour',
  'body',
  'astringency',
  'clarity',
  'comment',
  'tempC',
  'grind',
  'timeSec'
];

const RAW_TEXT_KEYS: ReadonlyArray<keyof FeedbackFormValues> = ['desiredDirectionText'];

function readTrimmed(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readRaw(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  return raw.trim().length === 0 ? undefined : raw;
}

export function formDataToFeedbackValues(formData: FormData): FeedbackFormValues {
  const out: FeedbackFormValues = {};
  for (const key of STRING_KEYS) {
    const v = readTrimmed(formData, key);
    if (v !== undefined) (out as Record<string, string>)[key] = v;
  }
  for (const key of RAW_TEXT_KEYS) {
    const v = readRaw(formData, key);
    if (v !== undefined) (out as Record<string, string>)[key] = v;
  }
  return out;
}

function parseInt10(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function linesToArray(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function feedbackValuesToInput(values: FeedbackFormValues): CreateFeedbackInput {
  const ratings: FeedbackRatings = {};
  for (const key of RATING_KEYS) {
    const parsed = parseInt10(values[key as keyof FeedbackFormValues]);
    if (parsed !== undefined) (ratings as Record<string, number>)[key] = parsed;
  }

  const input: CreateFeedbackInput = {
    recipeCode: (values.recipeCode ?? '') as CreateFeedbackInput['recipeCode'],
    ratings
  };

  if (values.comment) input.comment = values.comment;

  const desiredDirection = linesToArray(values.desiredDirectionText);
  if (desiredDirection.length > 0) input.desiredDirection = desiredDirection;

  const actual: NonNullable<CreateFeedbackInput['actual']> = {};
  const tempC = parseNumber(values.tempC);
  const timeSec = parseNumber(values.timeSec);
  if (tempC !== undefined) actual.tempC = tempC;
  if (timeSec !== undefined) actual.timeSec = timeSec;
  if (values.grind) actual.grind = values.grind;
  if (Object.keys(actual).length > 0) input.actual = actual;

  return input;
}
```

- [ ] **Step 4: Run the tests; confirm they pass**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/forms/feedback-form.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Full suite regression check**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/forms/feedback-form.ts apps/web/src/lib/forms/feedback-form.test.ts
git commit -m "feat(web): add feedback-form helper with vitest coverage"
```

---

## Task 9: Dashboard `/`

**Files:**
- Create: `apps/web/src/routes/+page.server.ts`
- Modify: `apps/web/src/routes/+page.svelte`

- [ ] **Step 1: Add the server `load`**

Create `apps/web/src/routes/+page.server.ts`:

```ts
import { env } from '$env/dynamic/private';
import type { RecipeDoc } from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { listRecentRecipes } from '$lib/server/repositories/recipes';
import type { PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

export const load: PageServerLoad = async () => {
  const config = getServerConfig(env);
  let recipes: RecipeDoc[] = [];
  let dbError: string | null = null;
  try {
    recipes = await listRecentRecipes(config.couch, 5);
  } catch {
    dbError = COUCH_UNREACHABLE;
  }
  return { recipes, dbError };
};
```

- [ ] **Step 2: Replace the placeholder dashboard UI**

Overwrite `apps/web/src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import RecipeCard from '$lib/ui/RecipeCard.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();
</script>

<svelte:head>
  <title>BrewDial</title>
</svelte:head>

<section class="stack">
  <div class="stack-tight">
    <h1>Dial in your next brew</h1>
    <p class="muted">
      Recipes, tasting feedback, and dial-in history for humans and agents.
    </p>
  </div>

  <div class="row">
    <a class="btn" href="/recipes/new">New recipe</a>
    <a class="btn btn-secondary" href="/recipes">All recipes</a>
  </div>

  {#if data.dbError}
    <ErrorPanel message={data.dbError} />
  {/if}

  <section class="stack-tight">
    <h2>Recent recipes</h2>
    {#if data.recipes.length === 0 && !data.dbError}
      <p class="muted">No recipes yet. Create your first one to start dialing in.</p>
    {:else}
      <div class="stack">
        {#each data.recipes as recipe (recipe._id)}
          <RecipeCard {recipe} />
        {/each}
      </div>
    {/if}
  </section>
</section>
```

- [ ] **Step 3: `pnpm check`**

```bash
pnpm check
```

Expected: zero errors.

- [ ] **Step 4: Smoke build**

```bash
pnpm build
```

Expected: SvelteKit build completes (recipe pages added later are still fine; the dashboard alone must compile).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/+page.server.ts apps/web/src/routes/+page.svelte
git commit -m "feat(web): dashboard page with recent recipes"
```

---

## Task 10: Recipe list `/recipes`

**Files:**
- Create: `apps/web/src/routes/recipes/+page.server.ts`
- Create: `apps/web/src/routes/recipes/+page.svelte`

- [ ] **Step 1: Server load**

Create `apps/web/src/routes/recipes/+page.server.ts`:

```ts
import { env } from '$env/dynamic/private';
import type { RecipeDoc } from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { listRecentRecipes } from '$lib/server/repositories/recipes';
import type { PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

export const load: PageServerLoad = async ({ url }) => {
  const config = getServerConfig(env);
  const limit = clampLimit(url.searchParams.get('limit'));
  let recipes: RecipeDoc[] = [];
  let dbError: string | null = null;
  try {
    recipes = await listRecentRecipes(config.couch, limit);
  } catch {
    dbError = COUCH_UNREACHABLE;
  }
  return { recipes, dbError, limit };
};
```

- [ ] **Step 2: List page UI**

Create `apps/web/src/routes/recipes/+page.svelte`:

```svelte
<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import RecipeCard from '$lib/ui/RecipeCard.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();
</script>

<svelte:head>
  <title>Recipes · BrewDial</title>
</svelte:head>

<section class="stack">
  <div class="row">
    <h1>Recipes</h1>
    <a class="btn" href="/recipes/new">New recipe</a>
  </div>

  {#if data.dbError}
    <ErrorPanel message={data.dbError} />
  {/if}

  {#if data.recipes.length === 0 && !data.dbError}
    <p class="muted">No recipes yet.</p>
  {:else}
    <div class="stack">
      {#each data.recipes as recipe (recipe._id)}
        <RecipeCard {recipe} />
      {/each}
    </div>
  {/if}
</section>
```

- [ ] **Step 3: `pnpm check`**

```bash
pnpm check
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/recipes/+page.server.ts apps/web/src/routes/recipes/+page.svelte
git commit -m "feat(web): /recipes list page"
```

---

## Task 11: New recipe `/recipes/new`

**Files:**
- Create: `apps/web/src/routes/recipes/new/+page.server.ts`
- Create: `apps/web/src/routes/recipes/new/+page.svelte`

- [ ] **Step 1: Form action server module**

Create `apps/web/src/routes/recipes/new/+page.server.ts`:

```ts
import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';
import { validateCreateRecipeInput } from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { createRecipe } from '$lib/server/repositories/recipes';
import {
  formDataToRecipeValues,
  recipeValuesToInput
} from '$lib/forms/recipe-form';
import type { Actions } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

export const actions: Actions = {
  default: async ({ request }) => {
    const config = getServerConfig(env);
    const formData = await request.formData();
    const values = formDataToRecipeValues(formData);
    const input = recipeValuesToInput(values);
    const validation = validateCreateRecipeInput(input);
    if (!validation.ok) {
      return fail(400, { errors: validation.errors, values });
    }
    let code: string;
    try {
      const recipe = await createRecipe(config.couch, validation.value);
      code = recipe.code;
    } catch {
      return fail(503, { errors: [COUCH_UNREACHABLE], values });
    }
    throw redirect(303, `/recipes/${code}`);
  }
};
```

- [ ] **Step 2: New-recipe form UI**

Create `apps/web/src/routes/recipes/new/+page.svelte`:

```svelte
<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import type { ActionData } from './$types';

  interface Props {
    form: ActionData;
  }
  let { form }: Props = $props();

  const v = form?.values ?? {};
</script>

<svelte:head>
  <title>New recipe · BrewDial</title>
</svelte:head>

<section class="stack">
  <h1>New recipe</h1>

  {#if form?.errors && form.errors.length > 0}
    <ErrorPanel message={form.errors.join(' · ')} />
  {/if}

  <form method="POST" class="stack">
    <div class="field">
      <label for="title">Title</label>
      <input id="title" name="title" required value={v.title ?? ''} />
    </div>

    <div class="field">
      <label for="method">Method</label>
      <select id="method" name="method" required>
        {#each ['v60', 'espresso', 'aeropress', 'kalita', 'other'] as opt}
          <option value={opt} selected={(v.method ?? 'v60') === opt}>{opt}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="beanName">Bean name</label>
      <input id="beanName" name="beanName" value={v.beanName ?? ''} />
    </div>

    <div class="field">
      <label for="roaster">Roaster</label>
      <input id="roaster" name="roaster" value={v.roaster ?? ''} />
    </div>

    <div class="field">
      <label for="roastDate">Roast date</label>
      <input id="roastDate" name="roastDate" type="date" value={v.roastDate ?? ''} />
    </div>

    <div class="field">
      <label for="doseG">Dose (g)</label>
      <input id="doseG" name="doseG" inputmode="decimal" value={v.doseG ?? ''} />
    </div>

    <div class="field">
      <label for="waterG">Water (g)</label>
      <input id="waterG" name="waterG" inputmode="decimal" value={v.waterG ?? ''} />
    </div>

    <div class="field">
      <label for="tempC">Temp (°C)</label>
      <input id="tempC" name="tempC" inputmode="decimal" value={v.tempC ?? ''} />
    </div>

    <div class="field">
      <label for="grind">Grind</label>
      <input id="grind" name="grind" value={v.grind ?? ''} />
    </div>

    <div class="field">
      <label for="targetTimeSec">Target time (s)</label>
      <input id="targetTimeSec" name="targetTimeSec" inputmode="numeric" value={v.targetTimeSec ?? ''} />
    </div>

    <div class="field">
      <label for="intentText">Intent (one per line)</label>
      <textarea id="intentText" name="intentText">{v.intentText ?? ''}</textarea>
    </div>

    <div class="field">
      <label for="stepsText">Steps (one note per line)</label>
      <textarea id="stepsText" name="stepsText">{v.stepsText ?? ''}</textarea>
    </div>

    <button type="submit" class="btn">Create recipe</button>
  </form>
</section>
```

- [ ] **Step 3: `pnpm check`**

```bash
pnpm check
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/recipes/new/+page.server.ts apps/web/src/routes/recipes/new/+page.svelte
git commit -m "feat(web): /recipes/new manual recipe creation form"
```

---

## Task 12: Recipe detail `/recipes/[code]`

**Files:**
- Create: `apps/web/src/routes/recipes/[code]/+page.server.ts`
- Create: `apps/web/src/routes/recipes/[code]/+page.svelte`

- [ ] **Step 1: Server load**

Create `apps/web/src/routes/recipes/[code]/+page.server.ts`:

```ts
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { isRecipeCode, type FeedbackDoc, type RecipeDoc } from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { getRecipeByCode } from '$lib/server/repositories/recipes';
import { listFeedbackForRecipe } from '$lib/server/repositories/feedback';
import type { PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

export const load: PageServerLoad = async ({ params }) => {
  if (!isRecipeCode(params.code)) {
    throw error(404, 'Recipe not found');
  }
  const config = getServerConfig(env);

  let recipe: RecipeDoc | null;
  try {
    recipe = await getRecipeByCode(config.couch, params.code);
  } catch {
    throw error(503, COUCH_UNREACHABLE);
  }
  if (!recipe) {
    throw error(404, 'Recipe not found');
  }

  let feedback: FeedbackDoc[] = [];
  let feedbackError: string | null = null;
  try {
    feedback = await listFeedbackForRecipe(config.couch, params.code);
  } catch {
    feedbackError = COUCH_UNREACHABLE;
  }

  return { recipe, feedback, feedbackError };
};
```

- [ ] **Step 2: Detail page UI**

Create `apps/web/src/routes/recipes/[code]/+page.svelte`:

```svelte
<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();

  const { recipe } = data;

  function formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }

  function ratingPairs(r: Record<string, unknown>): [string, unknown][] {
    return Object.entries(r);
  }
</script>

<svelte:head>
  <title>{recipe.code} · {recipe.title} · BrewDial</title>
</svelte:head>

<section class="stack">
  <div class="stack-tight">
    <p class="card-meta">
      <span class="code">{recipe.code}</span>
      <span class="muted"> · {recipe.method}</span>
      <span class="muted"> · {formatDate(recipe.createdAt)}</span>
    </p>
    <h1>{recipe.title}</h1>
  </div>

  {#if recipe.beanSnapshot && (recipe.beanSnapshot.name || recipe.beanSnapshot.roaster || recipe.beanSnapshot.roastDate)}
    <section class="stack-tight">
      <h2>Bean</h2>
      <dl class="dl">
        {#if recipe.beanSnapshot.name}
          <dt>Name</dt><dd>{recipe.beanSnapshot.name}</dd>
        {/if}
        {#if recipe.beanSnapshot.roaster}
          <dt>Roaster</dt><dd>{recipe.beanSnapshot.roaster}</dd>
        {/if}
        {#if recipe.beanSnapshot.roastDate}
          <dt>Roast date</dt><dd>{recipe.beanSnapshot.roastDate}</dd>
        {/if}
      </dl>
    </section>
  {/if}

  {#if Object.keys(recipe.params).length > 0}
    <section class="stack-tight">
      <h2>Params</h2>
      <dl class="dl">
        {#each Object.entries(recipe.params) as [key, value]}
          <dt>{key}</dt><dd>{value}</dd>
        {/each}
      </dl>
    </section>
  {/if}

  {#if recipe.steps.length > 0}
    <section class="stack-tight">
      <h2>Steps</h2>
      <ol>
        {#each recipe.steps as step, i (i)}
          <li>{step.note}</li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if recipe.intent && recipe.intent.length > 0}
    <section class="stack-tight">
      <h2>Intent</h2>
      <ul>
        {#each recipe.intent as item}
          <li>{item}</li>
        {/each}
      </ul>
    </section>
  {/if}

  <div>
    <a class="btn" href={`/feedback/new?recipeCode=${recipe.code}`}>Add feedback</a>
  </div>

  <section class="stack-tight">
    <h2>Feedback</h2>
    {#if data.feedbackError}
      <ErrorPanel message={data.feedbackError} />
    {:else if data.feedback.length === 0}
      <p class="muted">No feedback yet.</p>
    {:else}
      <div class="stack">
        {#each data.feedback as fb (fb._id)}
          <article class="card">
            <p class="card-meta muted">{formatDate(fb.createdAt)}</p>
            <dl class="dl">
              {#each ratingPairs(fb.ratings) as [k, v]}
                <dt>{k}</dt><dd>{v}</dd>
              {/each}
            </dl>
            {#if fb.comment}
              <p>{fb.comment}</p>
            {/if}
            {#if fb.desiredDirection && fb.desiredDirection.length > 0}
              <ul>
                {#each fb.desiredDirection as dd}
                  <li>{dd}</li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</section>
```

- [ ] **Step 3: `pnpm check`**

```bash
pnpm check
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/recipes/\[code\]/+page.server.ts apps/web/src/routes/recipes/\[code\]/+page.svelte
git commit -m "feat(web): /recipes/[code] detail page with feedback history"
```

---

## Task 13: Feedback form `/feedback/new`

**Files:**
- Create: `apps/web/src/routes/feedback/new/+page.server.ts`
- Create: `apps/web/src/routes/feedback/new/+page.svelte`

- [ ] **Step 1: Server load + form action**

Create `apps/web/src/routes/feedback/new/+page.server.ts`:

```ts
import { env } from '$env/dynamic/private';
import { error, fail, redirect } from '@sveltejs/kit';
import { isRecipeCode, validateCreateFeedbackInput } from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { getRecipeByCode } from '$lib/server/repositories/recipes';
import { addFeedback } from '$lib/server/repositories/feedback';
import { NotFoundError } from '$lib/server/errors';
import {
  feedbackValuesToInput,
  formDataToFeedbackValues
} from '$lib/forms/feedback-form';
import type { Actions, PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

export const load: PageServerLoad = async ({ url }) => {
  const recipeCode = url.searchParams.get('recipeCode');
  if (!recipeCode || !isRecipeCode(recipeCode)) {
    throw error(404, 'Recipe not found');
  }
  const config = getServerConfig(env);
  try {
    const recipe = await getRecipeByCode(config.couch, recipeCode);
    if (!recipe) throw error(404, 'Recipe not found');
    return { recipe };
  } catch (err) {
    if (err instanceof Error && 'status' in err) throw err;
    throw error(503, COUCH_UNREACHABLE);
  }
};

export const actions: Actions = {
  default: async ({ request }) => {
    const config = getServerConfig(env);
    const formData = await request.formData();
    const values = formDataToFeedbackValues(formData);
    const input = feedbackValuesToInput(values);
    const validation = validateCreateFeedbackInput(input);
    if (!validation.ok) {
      return fail(400, { errors: validation.errors, values });
    }
    try {
      await addFeedback(config.couch, validation.value);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return fail(404, { errors: [err.message], values });
      }
      return fail(503, { errors: [COUCH_UNREACHABLE], values });
    }
    throw redirect(303, `/recipes/${validation.value.recipeCode}`);
  }
};
```

Notes:
- The `'status' in err` re-throw preserves SvelteKit `error()` calls (which produce HTTP-shaped errors) instead of masking them as 503.
- `isRecipeCode` narrows `recipeCode` to `\`COF-${string}\``, so `getRecipeByCode` accepts it without a cast.

- [ ] **Step 2: Feedback form UI**

Create `apps/web/src/routes/feedback/new/+page.svelte`:

```svelte
<script lang="ts">
  import ErrorPanel from '$lib/ui/ErrorPanel.svelte';
  import RatingControl from '$lib/ui/RatingControl.svelte';
  import type { ActionData, PageData } from './$types';

  interface Props {
    data: PageData;
    form: ActionData;
  }
  let { data, form }: Props = $props();

  const v = form?.values ?? {};
  const recipe = data.recipe;
</script>

<svelte:head>
  <title>Feedback for {recipe.code} · BrewDial</title>
</svelte:head>

<section class="stack">
  <div class="stack-tight">
    <p class="card-meta">
      <span class="code">{recipe.code}</span>
      <span class="muted"> · {recipe.method}</span>
    </p>
    <h1>Feedback for {recipe.title}</h1>
  </div>

  {#if form?.errors && form.errors.length > 0}
    <ErrorPanel message={form.errors.join(' · ')} />
  {/if}

  <form method="POST" class="stack">
    <input type="hidden" name="recipeCode" value={recipe.code} />

    <RatingControl name="overall" label="Overall (1–5)" min={1} max={5} value={v.overall} />
    <RatingControl name="sweetness" label="Sweetness" value={v.sweetness} />
    <RatingControl name="burnt" label="Burnt" value={v.burnt} />
    <RatingControl name="bitter" label="Bitter" value={v.bitter} />
    <RatingControl name="sour" label="Sour" value={v.sour} />
    <RatingControl name="body" label="Body" value={v.body} />
    <RatingControl name="astringency" label="Astringency" value={v.astringency} />
    <RatingControl name="clarity" label="Clarity" value={v.clarity} />

    <div class="field">
      <label for="comment">Comment</label>
      <textarea id="comment" name="comment">{v.comment ?? ''}</textarea>
    </div>

    <div class="field">
      <label for="desiredDirectionText">Desired direction (one per line)</label>
      <textarea id="desiredDirectionText" name="desiredDirectionText">{v.desiredDirectionText ?? ''}</textarea>
    </div>

    <div class="field">
      <label for="tempC">Actual temp (°C)</label>
      <input id="tempC" name="tempC" inputmode="decimal" value={v.tempC ?? ''} />
    </div>

    <div class="field">
      <label for="grind">Actual grind</label>
      <input id="grind" name="grind" value={v.grind ?? ''} />
    </div>

    <div class="field">
      <label for="timeSec">Actual time (s)</label>
      <input id="timeSec" name="timeSec" inputmode="numeric" value={v.timeSec ?? ''} />
    </div>

    <button type="submit" class="btn">Submit feedback</button>
  </form>
</section>
```

- [ ] **Step 3: `pnpm check`**

```bash
pnpm check
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/feedback/new/+page.server.ts apps/web/src/routes/feedback/new/+page.svelte
git commit -m "feat(web): /feedback/new feedback creation form"
```

---

## Task 14: README + ADR 0004

**Files:**
- Modify: `README.md`
- Create: `docs/decisions/0004-mobile-ui-mvp.md`

- [ ] **Step 1: Append Mobile UI MVP section to `README.md`**

Insert this section above the existing `## License` line in `README.md`:

```markdown
## Mobile UI MVP

PR5 adds a mobile-first SvelteKit web UI for humans on top of the PR4 API.
Pages call the existing repository helpers server-side via SvelteKit `load`
functions and form `actions` — no client-side `fetch` to the local API. The
JSON API endpoints from PR4 remain unchanged for agents and the future MCP
server.

Routes:

- `/` — dashboard with most recent 5 recipes
- `/recipes` — recipe list (`?limit=N`, default 20, max 100)
- `/recipes/new` — manual recipe creation form
- `/recipes/COF-0001` — recipe detail with feedback history
- `/feedback/new?recipeCode=COF-0001` — feedback creation form

The UI requires a running, bootstrapped CouchDB (`pnpm db:bootstrap`) for real
data; without it, pages render a safe error message instead of stack traces or
config.

```bash
pnpm dev
# open http://localhost:5173
```
```

- [ ] **Step 2: Create ADR 0004**

Create `docs/decisions/0004-mobile-ui-mvp.md`:

```markdown
# 0004 — Mobile UI MVP

## Status

Accepted (PR5, Mobile UI MVP).

## Context

PR4 landed the agent-agnostic Recipe / Feedback JSON API on top of CouchDB.
PR5 needs to add the first human-facing surface so the system is usable on a
phone next to the brewer, without committing to auth, offline sync, an MCP
server, or a deployment story yet.

## Decision

### Why mobile UI follows the API foundation

- The API already encodes the data contract (`CreateRecipeInput`,
  `CreateFeedbackInput`), so the UI can reuse repositories and validation
  helpers instead of inventing parallel shapes.
- Building a UI in the same monorepo as the API keeps types end-to-end and
  removes the "client out of date with server" failure mode at MVP scale.
- The API is testable today; layering a UI on top means humans (the user) can
  smoke-test full flows without invoking agents.

### Why server `load` / `actions` instead of client-side `fetch` for PR5

- Server-rendered loads call repository helpers directly, avoiding an
  unnecessary HTTP round-trip from the SvelteKit server back to its own API.
- Form `actions` keep the create-recipe / submit-feedback flow as a single
  POST with a server-side redirect — no client JS, no spinners, no XHR error
  handling, and forms still work on flaky mobile networks.
- It collapses the review surface: a reviewer reads one server file and one
  Svelte file per page, instead of also auditing client fetch wrappers.
- The same pages can later opt into client enhancement (`use:enhance`) without
  the UI changing — server-first is a strict superset.

### Why no component library / no Tailwind

- The whole UI is five short pages and three primitives. A component library
  would import more code than the entire app currently weighs.
- Plain CSS with a small set of utility classes (`.btn`, `.card`, `.field`,
  `.stack`, `.row`) is enough for a mobile-first dial-in tool and keeps the
  bundle and the build minimal.
- Avoiding Tailwind also avoids a config + content-scan + plugin story that we
  do not need until there are dozens of components.

### Why no auth in PR5

- BrewDial is a single-user MacBook tool today; the public domain
  (`coffee.robinco.dev`) is planned but not yet served.
- Adding auth before the data model and the UI are stable just locks in a
  session shape we would have to redo when MCP / OAuth / agent identity lands.
- The CouchDB credentials in `apps/web/src/lib/server/config.ts` are the only
  secret today; UI pages must continue to redact configuration values from
  responses and logs.

## Non-goals (PR5)

- No agent context summary API.
- No MCP server.
- No PouchDB / offline sync.
- No deployment.
- No Playwright / e2e tests.
- No Tailwind, component library, client-side state library, or `zod`.
- No auth / sessions / login UI.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/decisions/0004-mobile-ui-mvp.md
git commit -m "docs: document mobile ui mvp and add ADR 0004"
```

---

## Task 15: Full validation, manual smoke, push, PR

**Files:** none

- [ ] **Step 1: Run the full check / build / test / lint sweep**

```bash
pnpm install
pnpm check
pnpm build
pnpm test
pnpm lint
```

Expected:
- `pnpm check` → 0 errors, 0 warnings.
- `pnpm build` → SvelteKit build succeeds, all 6 routes appear.
- `pnpm test` → all existing repository / shared / API tests pass plus the new `recipe-form` and `feedback-form` tests.
- `pnpm lint` → still the intentional no-op stub from PR1.

- [ ] **Step 2: Manual UI smoke test (skip cleanly if CouchDB is not local)**

If CouchDB is reachable:

```bash
pnpm db:bootstrap
pnpm dev
```

Then in a browser at `http://localhost:5173`:

1. Visit `/recipes/new` — form renders.
2. Submit a V60 with title "Test V60", method `v60`, dose 15, water 240, temp 92, plus 2 step lines.
3. Confirm the redirect lands on `/recipes/COF-0001` (or next code) and shows the saved recipe.
4. Click "Add feedback".
5. Submit feedback with `overall=4`, `sweetness=3`, `burnt=1`, comment "balanced".
6. Confirm redirect back to the recipe detail page and the new feedback row appears.
7. Visit `/recipes` — the new recipe appears at the top of the list.
8. Visit `/` — the new recipe appears under "Recent recipes".

If CouchDB is not available locally, instead verify each page renders its
"CouchDB is unreachable…" `ErrorPanel` without leaking config or stack
traces, and **note in the PR description that live UI smoke testing was
skipped**.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin ui-mvp
```

(If a `feat/mobile-ui-mvp` branch is preferred to match the source prompt's
naming, push with a `--push-option=...` rename or do
`git push -u origin ui-mvp:feat/mobile-ui-mvp`. The PR description below
applies either way.)

- [ ] **Step 4: Open the PR against `main`**

```bash
gh pr create --title "feat: add mobile ui mvp" --body "$(cat <<'EOF'
## Summary
- Added mobile-first app shell / navigation
- Added dashboard and recipe list pages
- Added manual recipe creation form
- Added recipe detail page with feedback history
- Added feedback creation form
- Added pure form helper utilities (`recipe-form`, `feedback-form`) with Vitest coverage
- Documented Mobile UI MVP in README and ADR 0004

## Validation
- [ ] pnpm install
- [ ] pnpm check
- [ ] pnpm build
- [ ] pnpm test
- [ ] pnpm lint
- [ ] live UI smoke test, if local CouchDB available

## Notes
- Agent context summary API intentionally deferred
- MCP server intentionally deferred
- Auth intentionally deferred
- PouchDB / offline sync intentionally deferred
- Playwright / e2e tests intentionally deferred
EOF
)"
```

Expected: `gh` prints the PR URL. Paste it back to the user.

---

## Self-review notes

- Spec coverage: layout (T3), dashboard (T9), list (T10), new recipe (T11), detail (T12), feedback (T13), `RecipeCard` / `ErrorPanel` / `RatingControl` (T4–T6), form helpers + tests (T7, T8), README + ADR 0004 (T14), validation + PR (T15) — all PR5 spec items have an owner task.
- Type consistency: `recipeValuesToInput` returns `CreateRecipeInput`; `feedbackValuesToInput` returns `CreateFeedbackInput`. Both feed `validateCreate*Input` (which accepts `unknown`), then the validated value flows to the existing `createRecipe` / `addFeedback` repositories. `RecipeFormValues` / `FeedbackFormValues` field names match the form `name` attributes used in the Svelte pages and the rating/string keys used in the tests.
- Server-side data access only: every `+page.server.ts` imports from `$lib/server/repositories/...`, never from `/api/...`. Matches the PR4 ADR rationale and the PR5 spec's "avoid HTTP-to-self" requirement.
- Error story: every page either returns `{ dbError }` to render an `ErrorPanel`, throws `error(404|503, ...)`, or returns `fail(status, { errors, values })` for forms. No raw stack traces, credentials, or config values can reach the client.
- Constraints: no Tailwind, no component library, no `zod`, no client-side state library, no Playwright, no auth, no Hermes-specific naming — confirmed by inspection of every code block in this plan.
