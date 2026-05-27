# ROB-333 — Recipes pagination & mobile timer phase UX

- **Linear:** [ROB-333](https://linear.app/mgh3326/issue/ROB-333/brewdial-fix-recipes-pagination-and-improve-mobile-timer-phase-ux)
- **Branch:** `fix/ROB-333-recipes-pagination-timer-mobile-phase-ux`
- **Date:** 2026-05-27
- **App:** `apps/web` (SvelteKit + Svelte 5 runes)

## Problem

1. `/recipes` shows only the most recent 20 recipes with no way to reach older
   ones. `listRecentRecipes` fetches every recipe doc, sorts by `createdAt`
   desc in memory, and slices to `limit` (default 20). The page exposes only a
   `?limit=` param and no pagination UI, so with >20 recipes (COF-0021/0022
   etc.) older cards are unreachable.
2. On the recipe timer page, the primary controls (Start/Pause/Resume/Reset)
   render *below* the dial, current-phase status, the full Pours list, and a
   help paragraph. On an iPhone-sized viewport the user must scroll down to
   press Start, then scroll back up to watch the dial.
3. The circular dial uses `--accent` (coffee brown) for progress regardless of
   phase, so an active pour and a wait/rest tail look the same. Only the thin
   sub-progress bar dims slightly while resting.

## Decisions (confirmed with user)

- **Pagination:** classic Prev/Next with a `?page=N` query param (not load-more).
- **Timer controls:** sticky bottom action bar (not reorder-only, not collapsible sections).
- **Wait color:** cool blue (`#4a6fa5` family); pour stays coffee/amber.

## Scope & non-goals

In scope: `apps/web` recipes list pagination, recipe timer mobile layout, and
pour-vs-wait visual states.

Non-goals (hard boundaries from the issue):
- No CouchDB document-shape / schema migration.
- No changes to BrewDial MCP tools, Hermes coffee profile guidance, or
  Cloudflare/launchd deploy automation or secrets.
- No production deploy from this session.
- Do **not** change `/api/recipes` HTTP behavior or `listRecentRecipes`
  semantics (the MCP app and existing tests depend on them).

## A. `/recipes` Prev/Next pagination

### Data layer — `apps/web/src/lib/server/repositories/recipes.ts`
- Extract a private `fetchAllRecipesSorted(config, fetchImpl)` helper holding
  the existing `getAllDocuments` range fetch (`startkey: 'recipe:'`,
  `endkey: 'recipe:￰'`, `includeDocs: true`) + `createdAt` desc sort.
- `listRecentRecipes` keeps its current signature and behavior by delegating to
  the helper then `.slice(0, safeLimit)` — so `/api/recipes` and
  `recipes.test.ts` are untouched.
- Add:
  ```ts
  export interface RecipePage {
    recipes: RecipeDoc[];
    total: number;
    page: number;       // normalized, 1-indexed
    pageSize: number;
    totalPages: number; // >= 1
  }
  export async function listRecipesPage(
    config: CouchConfig,
    opts: { page?: number; pageSize?: number },
    fetchImpl?: typeof fetch
  ): Promise<RecipePage>;
  ```
  Sort once, `total = sorted.length`, `totalPages = max(1, ceil(total/pageSize))`,
  clamp `page` into `[1, totalPages]`, slice
  `[(page-1)*pageSize, page*pageSize]`. One stable sort + offset slice ⇒ no
  duplicated or skipped cards across page transitions.

### Server load — `apps/web/src/routes/recipes/+page.server.ts`
- `PAGE_SIZE = 20` constant.
- Parse `?page` (parseInt, default 1, non-finite/≤0 → 1).
- Call `listRecipesPage`, return `{ recipes, page, totalPages, total, pageSize, dbError }`.
- On CouchDB failure keep the existing `dbError` path; return an empty page
  (`page: 1, totalPages: 1, total: 0`).

### UI — `apps/web/src/routes/recipes/+page.svelte`
- Below the card list, when `totalPages > 1`, render a pagination footer:
  `[← Prev]  Page {page} / {totalPages}  [Next →]`.
- Prev/Next are real `<a href="?page={n}">` anchors (progressive enhancement;
  reload + share stable, no client JS required).
- At bounds render the unavailable control as a disabled, non-link element
  (`aria-disabled`) so focus order and layout stay stable.
- Works on desktop and mobile (wraps with existing `.row` helpers / simple flex).

## B. Sticky timer controls — `apps/web/src/routes/recipes/[code]/+page.svelte`

- Move the **primary** controls into a sticky bar at the end of the
  `.brew-timer` section:
  - Start ⇄ Pause/Resume (existing toggle logic) + Reset.
  - `position: sticky; bottom: 0;` with opaque `--surface` background, top
    border, and `padding-bottom: env(safe-area-inset-bottom)`; a subtle top
    shadow to separate from scrolled content.
- Keep the dial + current-phase status block at the top of the section so they
  remain visible after Start.
- **Secondary** controls (알림 허용 / 사운드 toggle / 사운드 테스트) stay inline
  in the body, out of the sticky bar, to keep it focused on the core workflow.
- Pours list and help text stay visible (no collapsing); the sticky bar keeps
  the actions reachable while the list scrolls.
- On desktop the section is short, so the sticky bar simply renders at its
  natural position — no regression.

## C. Pour vs wait visual states

Derived from `inRestTail` = `isBrewPhaseResting(currentBrewPhase, elapsedSec)`
(existing phase model: `bloom | pour` with a rest tail). **No step-text parsing.**

### Tokens — `apps/web/src/app.css`
Add, in both `:root` and the dark-mode block (contrast-checked):

| Token            | Light     | Dark      | Use                     |
|------------------|-----------|-----------|-------------------------|
| `--wait`         | `#4a6fa5` | `#6f9bd6` | dial ring + sub-bar fill |
| `--wait-strong`  | `#2f4f7a` | `#9bc0ef` | wait pill text           |
| `--wait-soft`    | `#e6edf5` | `#1c2738` | wait pill background      |

### Surfaces
- **Dial** (`.dial::before` conic-gradient): replace the hard-coded `--accent`
  with `var(--dial-fill, var(--accent))`. Default `.dial { --dial-fill: var(--accent); }`;
  add `.dial.is-waiting { --dial-fill: var(--wait); }`. Component toggles
  `is-waiting` when `inRestTail`.
- **Phase pill**: add `.phase-pill-wait` (bg `--wait-soft`, color `--wait-strong`),
  applied when `inRestTail`. Copy conveys the action:
  - pouring/bloom → `{label} · 붓는 중`
  - resting → `{label} · 기다리는 중`
- **Sub-progress bar**: existing `.phase-progress.phase-kind-wait .phase-progress-fill`
  uses `var(--wait)` (replacing the `--surface-strong` → text-muted fallback).
- Text label ("붓는 중" / "기다리는 중") means the state is not conveyed by color
  alone (colorblind-safe). All tokens checked for dark-mode contrast; the prior
  dark-mode control-visibility regression must not return.

## Testing & verification

- **Unit** (`recipes.test.ts`): `listRecipesPage` — correct slice per page,
  `total`/`totalPages` math, page clamping (below 1, above max, empty dataset),
  and no overlap/gap between consecutive pages.
- `pour-schedule` rest logic is already unit-tested; the pour/wait color change
  is presentational. No `.svelte` component tests exist in the repo, so B and C
  are verified by manual smoke.
- **Manual smoke** (via `/browse`, 390×844 + dark mode):
  - `/recipes`: Prev/Next navigates, `Page X / Y` correct, reload of
    `?page=2` preserves state, no duplicate/skipped cards.
  - One timer page: Start reachable without scrolling far; after Start the dial
    is visible and Pause/Resume/Reset stay reachable; dial + pill + sub-bar flip
    to blue during a wait tail and back to amber on the next pour.
- **Gate:** `pnpm check`, `pnpm build`, `pnpm test`, `pnpm lint` — report all.

## Acceptance criteria (from issue)

- [x] With >20 recipes, `/recipes` exposes a working way to reach older/newer
      pages; reloading a `?page=N` URL preserves the expected list state.
- [x] No duplicate or skipped cards across page transitions in normal sort order.
- [x] Mobile (390×844): before start, the timer is usable without scrolling far
      below the timer content; after start, Pause/Resume/Reset stay reachable
      without losing current-phase context.
- [x] Active pour uses the pour color; wait/rest switches to a clearly different
      wait color; current-phase copy matches state.
- [x] Dark-mode contrast acceptable; no return of prior dark-mode control
      visibility regression.
- [x] `pnpm check` / `build` / `test` / `lint` pass; targeted smoke reported.
