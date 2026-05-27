# ROB-333 Recipes Pagination & Mobile Timer Phase UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add working Prev/Next pagination to `/recipes`, pin the recipe timer's primary controls to a sticky bottom bar on mobile, and color the timer dial/pill/sub-bar distinctly for pour vs wait phases.

**Architecture:** `/recipes` data is small and already fully fetched + sorted in memory, so pagination is a stable-sort + offset slice in a new `listRecipesPage` repo function, driven by a `?page=N` query param (reload/share-stable, anchor-link UI). The timer page moves Start/Pause/Resume/Reset into a `position: sticky; bottom: 0` bar and derives pour-vs-wait color from the existing `isBrewPhaseResting` signal (no step-text parsing) via a new `--wait` token family.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript, Vitest (node env), CouchDB `_all_docs`. Spec: `docs/superpowers/specs/2026-05-27-rob-333-recipes-pagination-timer-ux-design.md`.

**Conventions:** Single test file `src/lib/server/repositories/recipes.test.ts` already defines `config` and `makeRouter`. Run a single web test file with:
`pnpm --filter @brewdial/web exec vitest run src/lib/server/repositories/recipes.test.ts`

---

## Task 1: `listRecipesPage` data-layer function

**Files:**
- Modify: `apps/web/src/lib/server/repositories/recipes.ts`
- Test: `apps/web/src/lib/server/repositories/recipes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `apps/web/src/lib/server/repositories/recipes.test.ts`. It reuses the `config` and `makeRouter` already defined at the top of that file. Add `listRecipesPage` to the existing import from `./recipes`.

```ts
function recipeRow(code: string, createdAt: string) {
  return {
    id: `recipe:${code}`,
    key: `recipe:${code}`,
    value: { rev: '1-x' },
    doc: {
      _id: `recipe:${code}`,
      _rev: '1-x',
      type: 'recipe',
      code,
      method: 'v60',
      version: 1,
      title: code,
      params: {},
      steps: [],
      createdBy: 'manual',
      createdAt,
      updatedAt: createdAt
    }
  };
}

function makeAllDocsRouter(rows: ReturnType<typeof recipeRow>[]): typeof fetch {
  return makeRouter({
    'GET /coffee/_all_docs': () => ({
      status: 200,
      body: { total_rows: rows.length, offset: 0, rows }
    })
  });
}

describe('listRecipesPage', () => {
  // createdAt desc order: COF-0005, COF-0004, COF-0003, COF-0002, COF-0001
  const rows = [
    recipeRow('COF-0001', '2026-04-01T00:00:00Z'),
    recipeRow('COF-0002', '2026-04-02T00:00:00Z'),
    recipeRow('COF-0003', '2026-04-03T00:00:00Z'),
    recipeRow('COF-0004', '2026-04-04T00:00:00Z'),
    recipeRow('COF-0005', '2026-04-05T00:00:00Z')
  ];

  it('returns the first page newest-first with paging metadata', async () => {
    const result = await listRecipesPage(config, { page: 1, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(result.recipes.map((r) => r.code)).toEqual(['COF-0005', 'COF-0004']);
    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.totalPages).toBe(3);
  });

  it('returns the last partial page', async () => {
    const result = await listRecipesPage(config, { page: 3, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(result.recipes.map((r) => r.code)).toEqual(['COF-0001']);
    expect(result.page).toBe(3);
  });

  it('clamps an out-of-range page to the last page', async () => {
    const result = await listRecipesPage(config, { page: 99, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(result.page).toBe(3);
    expect(result.recipes.map((r) => r.code)).toEqual(['COF-0001']);
  });

  it('clamps page below 1 and non-finite to page 1', async () => {
    const zero = await listRecipesPage(config, { page: 0, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(zero.page).toBe(1);
    const nan = await listRecipesPage(config, { page: Number.NaN, pageSize: 2 }, makeAllDocsRouter(rows));
    expect(nan.page).toBe(1);
  });

  it('handles an empty dataset', async () => {
    const result = await listRecipesPage(config, { page: 1, pageSize: 2 }, makeAllDocsRouter([]));
    expect(result.recipes).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
  });

  it('never duplicates or skips a card across consecutive pages', async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const r = await listRecipesPage(config, { page, pageSize: 2 }, makeAllDocsRouter(rows));
      seen.push(...r.recipes.map((x) => x.code));
    }
    expect(seen).toEqual(['COF-0005', 'COF-0004', 'COF-0003', 'COF-0002', 'COF-0001']);
    expect(new Set(seen).size).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @brewdial/web exec vitest run src/lib/server/repositories/recipes.test.ts`
Expected: FAIL — `listRecipesPage is not a function` / import error.

- [ ] **Step 3: Implement `fetchAllRecipesSorted` + `listRecipesPage`**

In `apps/web/src/lib/server/repositories/recipes.ts`, add a `DEFAULT_PAGE_SIZE` constant near the existing `DEFAULT_LIMIT`/`MAX_LIMIT`:

```ts
const DEFAULT_PAGE_SIZE = 20;
```

Replace the current `listRecentRecipes` function body with a shared sort helper + delegation, then add the page function. The all-docs query (including the `endkey: 'recipe:￰'` sentinel) must stay byte-for-byte identical to today's:

```ts
async function fetchAllRecipesSorted(
  config: CouchConfig,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
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
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export async function listRecentRecipes(
  config: CouchConfig,
  limit: number = DEFAULT_LIMIT,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const sorted = await fetchAllRecipesSorted(config, fetchImpl);
  return sorted.slice(0, safeLimit);
}

export interface RecipePage {
  recipes: RecipeDoc[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listRecipesPage(
  config: CouchConfig,
  opts: { page?: number; pageSize?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<RecipePage> {
  const pageSize = Math.max(
    1,
    Math.min(MAX_LIMIT, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE)
  );
  const sorted = await fetchAllRecipesSorted(config, fetchImpl);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rawPage = Math.floor(opts.page ?? 1);
  const page = Math.max(
    1,
    Math.min(totalPages, Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1)
  );
  const start = (page - 1) * pageSize;
  const recipes = sorted.slice(start, start + pageSize);
  return { recipes, total, page, pageSize, totalPages };
}

export { DEFAULT_PAGE_SIZE };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @brewdial/web exec vitest run src/lib/server/repositories/recipes.test.ts`
Expected: PASS — all `listRecipesPage` tests green and the existing `listRecentRecipes`/`createRecipe`/`getRecipeByCode` tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/repositories/recipes.ts apps/web/src/lib/server/repositories/recipes.test.ts
git commit -m "feat(web): add listRecipesPage for /recipes pagination"
```

---

## Task 2: Wire `?page` into the recipes server load

**Files:**
- Modify (replace whole file): `apps/web/src/routes/recipes/+page.server.ts`

No unit test: load functions in this repo have none (they're thin glue over the tested repo layer that pulls `$env`/`$lib`). Behavior is covered by Task 1's tests + manual smoke in Task 6.

- [ ] **Step 1: Replace the load with page-based paging**

Overwrite `apps/web/src/routes/recipes/+page.server.ts` with:

```ts
import { env } from '$env/dynamic/private';
import { getServerConfig } from '$lib/server/config';
import {
  listRecipesPage,
  DEFAULT_PAGE_SIZE,
  type RecipePage
} from '$lib/server/repositories/recipes';
import type { PageServerLoad } from './$types';

const COUCH_UNREACHABLE = 'CouchDB is unreachable. Start CouchDB and run pnpm db:bootstrap.';

function parsePage(raw: string | null): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

export const load: PageServerLoad = async ({ url }) => {
  const config = getServerConfig(env);
  const page = parsePage(url.searchParams.get('page'));
  let result: RecipePage = {
    recipes: [],
    total: 0,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    totalPages: 1
  };
  let dbError: string | null = null;
  try {
    result = await listRecipesPage(config.couch, { page });
  } catch {
    dbError = COUCH_UNREACHABLE;
  }
  return { ...result, dbError };
};
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @brewdial/web check`
Expected: PASS (0 errors). The page load now exposes `recipes`, `page`, `totalPages`, `total`, `pageSize`, `dbError` to `+page.svelte`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/recipes/+page.server.ts
git commit -m "feat(web): drive /recipes load from ?page param"
```

---

## Task 3: Prev/Next pagination UI

**Files:**
- Modify: `apps/web/src/routes/recipes/+page.svelte`

- [ ] **Step 1: Add the pager nav**

In `apps/web/src/routes/recipes/+page.svelte`, the markup currently ends with the recipes `{#if … }{:else} … {/if}` block inside `<section class="stack">`. Add the pager immediately **after** that closing `{/if}` and before `</section>`:

```svelte
  {#if data.totalPages > 1}
    <nav class="pager" aria-label="레시피 페이지">
      {#if data.page > 1}
        <a class="btn btn-secondary" href="?page={data.page - 1}" rel="prev">← 이전</a>
      {:else}
        <span class="btn btn-secondary pager-disabled" aria-disabled="true">← 이전</span>
      {/if}
      <span class="pager-status muted">{data.page} / {data.totalPages} 페이지</span>
      {#if data.page < data.totalPages}
        <a class="btn btn-secondary" href="?page={data.page + 1}" rel="next">다음 →</a>
      {:else}
        <span class="btn btn-secondary pager-disabled" aria-disabled="true">다음 →</span>
      {/if}
    </nav>
  {/if}
```

- [ ] **Step 2: Add scoped styles**

Add a `<style>` block at the end of `apps/web/src/routes/recipes/+page.svelte` (the file currently has none):

```svelte
<style>
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .pager-status {
    font-variant-numeric: tabular-nums;
  }

  .pager-disabled {
    opacity: 0.5;
    pointer-events: none;
  }
</style>
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @brewdial/web check`
Expected: PASS (0 errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/recipes/+page.svelte
git commit -m "feat(web): add Prev/Next pager to /recipes"
```

---

## Task 4: Sticky bottom action bar on the timer page

**Files:**
- Modify: `apps/web/src/routes/recipes/[code]/+page.svelte`

Goal: keep Start/Pause/Resume + Reset reachable without scrolling. The current controls `<div class="row"> … </div>` (lines ~349–364) holds five things: the primary Start/Pause toggle, Reset, the optional 알림 허용 button, the 사운드 checkbox, and 사운드 테스트. Split the **primary** actions into a sticky bar at the end of the section; leave the secondary controls inline.

- [ ] **Step 1: Replace the controls block**

In `apps/web/src/routes/recipes/[code]/+page.svelte`, replace this existing block:

```svelte
      <div class="row">
        {#if isTimerRunning}
          <button class="btn" type="button" onclick={pauseTimer}>Pause</button>
        {:else}
          <button class="btn" type="button" onclick={startTimer}>{elapsedSec > 0 ? 'Resume' : 'Start brew'}</button>
        {/if}
        <button class="btn btn-secondary" type="button" onclick={resetTimer}>Reset</button>
        {#if notificationPermission === 'default'}
          <button class="btn btn-secondary" type="button" onclick={requestNotifications}>알림 허용</button>
        {/if}
        <label class="sound-toggle">
          <input type="checkbox" bind:checked={soundEnabled} onchange={onSoundToggle} />
          사운드
        </label>
        <button class="btn btn-secondary" type="button" onclick={testSound}>사운드 테스트</button>
      </div>
```

with this — secondary controls stay inline, primary actions move to a sticky bar that is the **last** element of the `.brew-timer` section:

```svelte
      <div class="row">
        {#if notificationPermission === 'default'}
          <button class="btn btn-secondary" type="button" onclick={requestNotifications}>알림 허용</button>
        {/if}
        <label class="sound-toggle">
          <input type="checkbox" bind:checked={soundEnabled} onchange={onSoundToggle} />
          사운드
        </label>
        <button class="btn btn-secondary" type="button" onclick={testSound}>사운드 테스트</button>
      </div>

      <div class="timer-actions">
        {#if isTimerRunning}
          <button class="btn" type="button" onclick={pauseTimer}>Pause</button>
        {:else}
          <button class="btn" type="button" onclick={startTimer}>{elapsedSec > 0 ? 'Resume' : 'Start brew'}</button>
        {/if}
        <button class="btn btn-secondary" type="button" onclick={resetTimer}>Reset</button>
      </div>
```

- [ ] **Step 2: Add sticky-bar styles**

In the existing `<style>` block of `apps/web/src/routes/recipes/[code]/+page.svelte`, add:

```css
  .timer-actions {
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flex;
    gap: 0.75rem;
    /* Bleed to the card edges and sit flush at the card's bottom. */
    margin: 0.25rem -1rem -1rem;
    padding: 0.75rem 1rem;
    padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 1px solid var(--border);
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
    border-bottom-left-radius: var(--radius);
    border-bottom-right-radius: var(--radius);
  }

  .timer-actions .btn {
    flex: 1;
  }
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @brewdial/web check`
Expected: PASS (0 errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/recipes/[code]/+page.svelte
git commit -m "feat(web): pin recipe timer controls to a sticky bottom bar"
```

---

## Task 5: Pour vs wait colors (tokens + dial/pill/sub-bar)

**Files:**
- Modify: `apps/web/src/app.css`
- Modify: `apps/web/src/routes/recipes/[code]/+page.svelte`

Color is derived from `inRestTail` (already computed at line ~47 as `isBrewPhaseResting(...)`). No step-text parsing.

- [ ] **Step 1: Add `--wait` tokens (light + dark)**

In `apps/web/src/app.css`, in the `:root` block, add right after the `--accent-soft: #efe6dc;` line:

```css
  --wait: #4a6fa5;
  --wait-strong: #2f4f7a;
  --wait-soft: #e6edf5;
```

In the `@media (prefers-color-scheme: dark)` `:root` block, add right after the `--accent-soft: #2e251c;` line:

```css
    --wait: #6f9bd6;
    --wait-strong: #9bc0ef;
    --wait-soft: #1c2738;
```

- [ ] **Step 2: Make the dial fill switchable + add the wait pill variant**

In `apps/web/src/app.css`, find the `.dial` rule and add a `--dial-fill` default. Change:

```css
.dial {
  position: relative;
  width: min(240px, 70vw);
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--surface);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  margin: 0 auto;
}
```

to add the line `  --dial-fill: var(--accent);` (anywhere inside the rule, e.g. as the first declaration). Then update the `.dial::before` conic-gradient — change `var(--accent)` to `var(--dial-fill, var(--accent))`:

```css
.dial::before {
  content: '';
  position: absolute;
  inset: 8px;
  border-radius: 50%;
  background: conic-gradient(
    var(--dial-fill, var(--accent)) calc(var(--dial-progress, 0) * 360deg),
    var(--surface-muted) 0
  );
  -webkit-mask: radial-gradient(circle, transparent 0 calc(50% - 8px), #000 calc(50% - 8px));
  mask: radial-gradient(circle, transparent 0 calc(50% - 8px), #000 calc(50% - 8px));
}
```

Add a waiting override immediately after the `.dial::before` rule:

```css
.dial.is-waiting {
  --dial-fill: var(--wait);
}
```

Add a wait pill variant immediately after the existing `.phase-pill { … }` rule:

```css
.phase-pill-wait {
  background: var(--wait-soft);
  color: var(--wait-strong);
}
```

- [ ] **Step 3: Apply state classes + copy in the timer markup**

In `apps/web/src/routes/recipes/[code]/+page.svelte`:

Change the phase pill line:

```svelte
          <span class="phase-pill">{phasePillLabel(currentBrewPhase)}{inRestTail ? ' · 쉬는 중' : ''}</span>
```

to:

```svelte
          <span class="phase-pill {inRestTail ? 'phase-pill-wait' : ''}">{phasePillLabel(currentBrewPhase)} · {inRestTail ? '기다리는 중' : '붓는 중'}</span>
```

Change the dial element opening tag:

```svelte
        <div
          class="dial"
          style="--dial-progress: {dialProgress}"
          role="timer"
          aria-label="추출 경과 시간"
        >
```

to add the `is-waiting` class:

```svelte
        <div
          class="dial {inRestTail ? 'is-waiting' : ''}"
          style="--dial-progress: {dialProgress}"
          role="timer"
          aria-label="추출 경과 시간"
        >
```

- [ ] **Step 4: Point the sub-progress wait fill at the real token**

In the `<style>` block of `apps/web/src/routes/recipes/[code]/+page.svelte`, change:

```css
  .phase-progress.phase-kind-wait .phase-progress-fill {
    background: var(--surface-strong, var(--text-muted));
  }
```

to:

```css
  .phase-progress.phase-kind-wait .phase-progress-fill {
    background: var(--wait);
  }
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @brewdial/web check`
Expected: PASS (0 errors).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app.css apps/web/src/routes/recipes/[code]/+page.svelte
git commit -m "feat(web): distinguish pour vs wait phase color on timer dial"
```

---

## Task 6: Full verification gate + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the full check/test/build/lint gate from repo root**

```bash
pnpm check
pnpm test
pnpm build
pnpm lint
```

Expected: `check` 0 errors; `test` all green (including the new `listRecipesPage` suite); `build` succeeds; `lint` prints the intentional web no-op and exits 0. Report actual output — do not claim success without it (use superpowers:verification-before-completion).

- [ ] **Step 2: Manual smoke via `/browse` (per CLAUDE.md, use gstack `/browse`)**

Start the app (`pnpm --filter @brewdial/web dev`) against a CouchDB with >20 recipes, then verify at viewport 390×844, light + dark:

- `/recipes`: pager shows `1 / N`; **다음 →** advances and the URL becomes `?page=2`; reloading `?page=2` keeps page 2; **← 이전** returns to page 1; spot-check that the last card of page 1 and first card of page 2 are adjacent in `createdAt` order (no duplicate, no gap); pager controls are visible/contrasting in dark mode.
- One recipe timer page (`/recipes/<code>`): before pressing Start, the dial + current-phase text are on-screen and Start is reachable without long scrolling (sticky bar at bottom); press Start — the dial stays visible and Pause/Reset remain reachable; during an active pour the dial ring + pill are amber/coffee with `· 붓는 중`; when a pour reaches its rest tail the dial ring, pill (`· 기다리는 중`), and sub-progress bar all switch to blue; confirm button text/contrast is fine in dark mode (no return of the prior dark-mode control-visibility regression).

- [ ] **Step 3: Tick the spec's acceptance criteria**

Open `docs/superpowers/specs/2026-05-27-rob-333-recipes-pagination-timer-ux-design.md` and check off the Acceptance criteria boxes that the gate + smoke confirmed; note anything deferred.

---

## Self-review notes

- **Spec coverage:** A → Tasks 1–3; B → Task 4; C → Task 5; testing/verification → Task 1 (unit) + Task 6 (gate + smoke). All spec sections mapped.
- **Boundaries honored:** `listRecentRecipes` and `/api/recipes` untouched (Task 1 keeps the signature, only refactors the shared sort); no CouchDB schema, MCP, deploy, or secret changes; no production deploy.
- **Type consistency:** `RecipePage` shape (`recipes/total/page/pageSize/totalPages`) defined in Task 1 is consumed unchanged in Task 2 and read as `data.page`/`data.totalPages` in Task 3. `--dial-fill`, `--wait`, `--wait-strong`, `--wait-soft`, `.is-waiting`, `.phase-pill-wait`, `.phase-kind-wait` names are consistent across Task 5 CSS and markup.
