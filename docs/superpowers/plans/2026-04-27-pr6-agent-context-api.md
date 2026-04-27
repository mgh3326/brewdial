# PR6 — Agent Context Summary API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Agent Context Summary API (`GET /api/context`, `GET /api/context/[code]`) that composes recent recipes, their feedback, and global preferences into deterministic agent-friendly context — landed as PR `feat/agent-context-api` against `main`.

**Architecture:** Three layers. Shared response types in `@brewdial/shared` (`packages/shared/src/api-types.ts`). A new server-side service module `apps/web/src/lib/server/context.ts` that composes existing repositories (`recipes`, `feedback`, `preferences`) and produces deterministic guidance — no LLM, no scoring beyond simple count/threshold checks. SvelteKit `+server.ts` route handlers that call the service and return safe JSON errors (`400` invalid code, `404` unknown recipe, `503` CouchDB unreachable).

**Tech Stack:** pnpm@10.33.2, Node ≥22, TypeScript, SvelteKit, plain CSS, CouchDB via `fetch`, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-04-27-agent-context-api-design.md` (committed in this repo).

**Source prompt:** `brewdial-pr6-agent-context-summary-api.md` (passed in by the user; not committed under the repo).

---

## Pre-flight

Run from the local repository root. Confirm:

- `pnpm --version` reports `10.33.2`
- `node --version` reports `>=22`
- `git remote -v` shows `git@github.com:mgh3326/brewdial`
- Latest `main` includes PR5 (Mobile UI MVP merge — commit `7bb33c0` or later)
- Working tree clean

If those check out, create the feature branch in **Task 1**.

---

## File map

| Path | Action | Owner Task |
| --- | --- | --- |
| `packages/shared/src/api-types.ts` | modify (add context response types) | T2 |
| `apps/web/src/lib/server/context.ts` | create | T3 — T6 |
| `apps/web/src/lib/server/context.test.ts` | create | T3 — T6 |
| `apps/web/src/routes/api/context/+server.ts` | create | T7 |
| `apps/web/src/routes/api/context/[code]/+server.ts` | create | T8 |
| `README.md` | modify (status note + Agent Context API section) | T9 |
| `docs/decisions/0005-agent-context-api.md` | create | T9 |

Route-level test files are intentionally not added. Per the design spec, integration coverage stays at the service layer (`context.test.ts`); the route handlers are thin wrappers. The PR description should call this out.

---

## Task 1: Create the feature branch

**Files:** none

- [ ] **Step 1: Sync `main` and confirm PR5 is the tip**

```bash
git checkout main
git pull --ff-only
git log --oneline -1
```

Expected: top line is `7bb33c0 Merge pull request #5 from mgh3326/ui-mvp` or a later `main` commit on top of it.

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/agent-context-api
```

Expected: `Switched to a new branch 'feat/agent-context-api'`.

- [ ] **Step 3: Confirm clean tree and tool versions**

```bash
git status --short --branch
pnpm --version
node --version
```

Expected: branch line `## feat/agent-context-api`, no other output from `git status`; pnpm reports `10.33.2`; node reports `>=22`.

---

## Task 2: Add shared response types

**Files:**
- Modify: `packages/shared/src/api-types.ts`

These types are consumed by both the service module and the route handlers. They are pure interfaces — no test file is needed; `pnpm check` is the verification gate.

- [ ] **Step 1: Extend the import block**

Open `packages/shared/src/api-types.ts`. Replace the existing import block at the top:

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
```

with:

```ts
import type {
  ActualBrewParams,
  BrewMethod,
  FeedbackDoc,
  FeedbackRatings,
  PreferenceDoc,
  RecipeDoc,
  RecipeParams,
  RecipeStep
} from './types';
```

- [ ] **Step 2: Append the context response types**

Append the following to the end of `packages/shared/src/api-types.ts` (after the existing `ApiErrorResponse` interface):

```ts
export interface FeedbackSummary {
  count: number;
  latestAt: string | null;
  averageOverall: number | null;
  commonDesiredDirections: string[];
  latestComment: string | null;
}

export interface RecipeWithFeedbackSummary {
  recipe: RecipeDoc;
  feedback: FeedbackDoc[];
  feedbackSummary: FeedbackSummary;
}

export interface ContextSummary {
  generatedAt: string;
  preferences: PreferenceDoc | null;
  recentRecipes: RecipeWithFeedbackSummary[];
  totals: {
    recipes: number;
    feedback: number;
  };
  guidance: string[];
}

export interface ContextSummaryResponse {
  context: ContextSummary;
}

export interface RecipeContext {
  generatedAt: string;
  preferences: PreferenceDoc | null;
  recipe: RecipeDoc;
  feedback: FeedbackDoc[];
  feedbackSummary: FeedbackSummary;
  guidance: string[];
}

export interface RecipeContextResponse {
  context: RecipeContext;
}
```

- [ ] **Step 3: Verify type-check passes**

Run:

```bash
pnpm check
```

Expected: completes with `0 errors / 0 warnings` across both workspaces. (`packages/shared/src/index.ts` already re-exports `./api-types`, so the new symbols become part of `@brewdial/shared` automatically.)

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/api-types.ts
git commit -m "feat(shared): add agent context response types"
```

---

## Task 3: `summarizeFeedback`

**Files:**
- Create: `apps/web/src/lib/server/context.ts`
- Create: `apps/web/src/lib/server/context.test.ts`

This is a pure function over `FeedbackDoc[]`. All logic is deterministic; tests run without any mocked fetch.

- [ ] **Step 1: Write the failing test file**

Create `apps/web/src/lib/server/context.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import type { FeedbackDoc } from '@brewdial/shared';
import { summarizeFeedback } from './context';

function fb(partial: Partial<FeedbackDoc> & Pick<FeedbackDoc, 'createdAt'>): FeedbackDoc {
  return {
    _id: partial._id ?? `feedback:COF-0001:${partial.createdAt}`,
    type: 'feedback',
    recipeCode: partial.recipeCode ?? 'COF-0001',
    recipeId: partial.recipeId ?? 'recipe:COF-0001',
    ratings: partial.ratings ?? {},
    source: partial.source ?? 'web',
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt ?? partial.createdAt,
    ...(partial.comment !== undefined ? { comment: partial.comment } : {}),
    ...(partial.desiredDirection !== undefined
      ? { desiredDirection: partial.desiredDirection }
      : {})
  };
}

describe('summarizeFeedback', () => {
  it('returns zero/null fields for empty feedback', () => {
    expect(summarizeFeedback([])).toEqual({
      count: 0,
      latestAt: null,
      averageOverall: null,
      commonDesiredDirections: [],
      latestComment: null
    });
  });

  it('counts entries and picks the max createdAt for latestAt', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z' }),
      fb({ createdAt: '2026-04-22T00:00:00Z' }),
      fb({ createdAt: '2026-04-21T00:00:00Z' })
    ]);
    expect(out.count).toBe(3);
    expect(out.latestAt).toBe('2026-04-22T00:00:00Z');
  });

  it('averages only overall ratings that are present, rounded to <=2 decimals', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z', ratings: { overall: 4 } }),
      fb({ createdAt: '2026-04-21T00:00:00Z', ratings: { overall: 5 } }),
      fb({ createdAt: '2026-04-22T00:00:00Z', ratings: {} }),
      fb({ createdAt: '2026-04-23T00:00:00Z', ratings: { overall: 2 } })
    ]);
    // (4 + 5 + 2) / 3 = 3.6666... -> 3.67
    expect(out.averageOverall).toBe(3.67);
  });

  it('returns averageOverall null when no feedback has overall', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z', ratings: {} }),
      fb({ createdAt: '2026-04-21T00:00:00Z', ratings: {} })
    ]);
    expect(out.averageOverall).toBeNull();
  });

  it('produces commonDesiredDirections trimmed, deduped, frequency-first then first-seen order', () => {
    const out = summarizeFeedback([
      fb({
        createdAt: '2026-04-20T00:00:00Z',
        desiredDirection: ['  sweeter ', 'less burnt', '']
      }),
      fb({
        createdAt: '2026-04-21T00:00:00Z',
        desiredDirection: ['sweeter', 'more body']
      }),
      fb({
        createdAt: '2026-04-22T00:00:00Z',
        desiredDirection: ['more body', 'less burnt']
      })
    ]);
    // counts: sweeter=2, less burnt=2, more body=2
    // first-seen order: sweeter (idx 0), less burnt (idx 1), more body (idx 2)
    expect(out.commonDesiredDirections).toEqual(['sweeter', 'less burnt', 'more body']);
  });

  it('picks the latest comment by createdAt and ignores empty/whitespace comments', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z', comment: 'first' }),
      fb({ createdAt: '2026-04-21T00:00:00Z', comment: '   ' }),
      fb({ createdAt: '2026-04-22T00:00:00Z', comment: 'newest comment' }),
      fb({ createdAt: '2026-04-23T00:00:00Z' })
    ]);
    expect(out.latestComment).toBe('newest comment');
  });

  it('returns latestComment null when no feedback has a non-empty comment', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z' }),
      fb({ createdAt: '2026-04-21T00:00:00Z', comment: '' })
    ]);
    expect(out.latestComment).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/server/context.test.ts
```

Expected: vitest reports a module-resolution error such as `Failed to resolve import "./context"` or `Cannot find module './context'` — the implementation file does not exist yet.

- [ ] **Step 3: Create the implementation file with `summarizeFeedback`**

Create `apps/web/src/lib/server/context.ts` with:

```ts
import type {
  FeedbackDoc,
  FeedbackSummary
} from '@brewdial/shared';

export function summarizeFeedback(feedback: FeedbackDoc[]): FeedbackSummary {
  if (feedback.length === 0) {
    return {
      count: 0,
      latestAt: null,
      averageOverall: null,
      commonDesiredDirections: [],
      latestComment: null
    };
  }

  let latestAt: string | null = null;
  for (const f of feedback) {
    if (latestAt === null || f.createdAt > latestAt) {
      latestAt = f.createdAt;
    }
  }

  const overalls: number[] = [];
  for (const f of feedback) {
    if (typeof f.ratings.overall === 'number') overalls.push(f.ratings.overall);
  }
  const averageOverall =
    overalls.length === 0
      ? null
      : Math.round(
          (overalls.reduce((a, b) => a + b, 0) / overalls.length) * 100
        ) / 100;

  const directionOrder = new Map<string, { count: number; firstIndex: number }>();
  let nextIndex = 0;
  for (const f of feedback) {
    for (const raw of f.desiredDirection ?? []) {
      const key = raw.trim();
      if (!key) continue;
      const entry = directionOrder.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        directionOrder.set(key, { count: 1, firstIndex: nextIndex });
        nextIndex += 1;
      }
    }
  }
  const commonDesiredDirections = [...directionOrder.entries()]
    .sort(
      (a, b) => b[1].count - a[1].count || a[1].firstIndex - b[1].firstIndex
    )
    .map(([key]) => key);

  let latestCommentDoc: FeedbackDoc | null = null;
  for (const f of feedback) {
    const trimmed = f.comment?.trim();
    if (!trimmed) continue;
    if (
      latestCommentDoc === null ||
      f.createdAt > latestCommentDoc.createdAt
    ) {
      latestCommentDoc = f;
    }
  }
  const latestComment = latestCommentDoc?.comment ?? null;

  return {
    count: feedback.length,
    latestAt,
    averageOverall,
    commonDesiredDirections,
    latestComment
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/server/context.test.ts
```

Expected: all seven `summarizeFeedback` tests pass; vitest reports `Tests  7 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/context.ts apps/web/src/lib/server/context.test.ts
git commit -m "feat(web): add summarizeFeedback helper"
```

---

## Task 4: `buildContextGuidance` and `buildRecipeGuidance`

**Files:**
- Modify: `apps/web/src/lib/server/context.ts`
- Modify: `apps/web/src/lib/server/context.test.ts`

Two pure functions that produce deterministic, conservative guidance strings. Same TDD cycle.

- [ ] **Step 1: Append the failing tests**

Append to `apps/web/src/lib/server/context.test.ts`:

```ts
import type {
  FeedbackSummary,
  PreferenceDoc,
  RecipeDoc,
  RecipeWithFeedbackSummary
} from '@brewdial/shared';
import { buildContextGuidance, buildRecipeGuidance } from './context';

function recipe(code: `COF-${string}`): RecipeDoc {
  return {
    _id: `recipe:${code}`,
    type: 'recipe',
    code,
    method: 'v60',
    version: 1,
    title: code,
    params: {},
    steps: [],
    createdBy: 'manual',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z'
  };
}

function summary(partial: Partial<FeedbackSummary> = {}): FeedbackSummary {
  return {
    count: partial.count ?? 0,
    latestAt: partial.latestAt ?? null,
    averageOverall: partial.averageOverall ?? null,
    commonDesiredDirections: partial.commonDesiredDirections ?? [],
    latestComment: partial.latestComment ?? null
  };
}

function entry(
  code: `COF-${string}`,
  partial: Partial<FeedbackSummary> = {}
): RecipeWithFeedbackSummary {
  return { recipe: recipe(code), feedback: [], feedbackSummary: summary(partial) };
}

const prefs: PreferenceDoc = {
  _id: 'preference:global',
  type: 'preference',
  likes: ['floral', 'citrus'],
  dislikes: ['bitter'],
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z'
};

describe('buildContextGuidance', () => {
  it('emits the no-recipes hint when recipes is empty', () => {
    const out = buildContextGuidance({ preferences: null, recipes: [] });
    expect(out).toContain(
      'No recipes yet. Create a baseline recipe before asking for dial-in suggestions.'
    );
  });

  it('emits the no-feedback hint for the most recent recipe', () => {
    const out = buildContextGuidance({
      preferences: null,
      recipes: [entry('COF-0002'), entry('COF-0001', { count: 3 })]
    });
    expect(out).toContain(
      'Recent recipe COF-0002 has no feedback yet; collect tasting notes before changing parameters.'
    );
  });

  it('emits the low-average hint when averageOverall < 3', () => {
    const out = buildContextGuidance({
      preferences: null,
      recipes: [entry('COF-0003', { count: 2, averageOverall: 2.5 })]
    });
    expect(out).toContain(
      'COF-0003 average overall is below 3; inspect feedback comments and desired directions before repeating.'
    );
  });

  it('does not emit recipe hints when newest recipe has feedback with avg >= 3', () => {
    const out = buildContextGuidance({
      preferences: null,
      recipes: [entry('COF-0004', { count: 2, averageOverall: 4 })]
    });
    expect(out).toEqual([]);
  });

  it('appends a preference summary line when likes or dislikes are present', () => {
    const out = buildContextGuidance({
      preferences: prefs,
      recipes: [entry('COF-0005', { count: 1, averageOverall: 4 })]
    });
    expect(out).toContain('Preferences: likes [floral, citrus]; dislikes [bitter].');
  });

  it('omits the preference line when both likes and dislikes are empty', () => {
    const out = buildContextGuidance({
      preferences: { ...prefs, likes: [], dislikes: [] },
      recipes: [entry('COF-0006', { count: 1, averageOverall: 4 })]
    });
    expect(out.find((s) => s.startsWith('Preferences:'))).toBeUndefined();
  });
});

describe('buildRecipeGuidance', () => {
  it('emits the no-feedback hint when count is 0', () => {
    const out = buildRecipeGuidance({
      preferences: null,
      recipe: recipe('COF-0010'),
      feedbackSummary: summary({ count: 0 })
    });
    expect(out).toContain(
      'Recipe COF-0010 has no feedback yet; collect tasting notes before changing parameters.'
    );
  });

  it('emits the low-average hint when averageOverall < 3', () => {
    const out = buildRecipeGuidance({
      preferences: null,
      recipe: recipe('COF-0011'),
      feedbackSummary: summary({ count: 4, averageOverall: 2.99 })
    });
    expect(out).toContain(
      'COF-0011 average overall is below 3; inspect feedback comments and desired directions before repeating.'
    );
  });

  it('appends preference line when present', () => {
    const out = buildRecipeGuidance({
      preferences: prefs,
      recipe: recipe('COF-0012'),
      feedbackSummary: summary({ count: 2, averageOverall: 4 })
    });
    expect(out).toContain('Preferences: likes [floral, citrus]; dislikes [bitter].');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/server/context.test.ts
```

Expected: vitest reports `buildContextGuidance is not a function` (or a module-resolution error for the missing exports). The previously-passing `summarizeFeedback` tests should still pass.

- [ ] **Step 3: Append the implementation**

Append to `apps/web/src/lib/server/context.ts` (after the existing imports, extend the `@brewdial/shared` import block to include the new type names; then add the function definitions after `summarizeFeedback`):

Replace the existing import block:

```ts
import type {
  FeedbackDoc,
  FeedbackSummary
} from '@brewdial/shared';
```

with:

```ts
import type {
  FeedbackDoc,
  FeedbackSummary,
  PreferenceDoc,
  RecipeDoc,
  RecipeWithFeedbackSummary
} from '@brewdial/shared';
```

Then append after the `summarizeFeedback` function:

```ts
export interface ContextGuidanceInput {
  preferences: PreferenceDoc | null;
  recipes: RecipeWithFeedbackSummary[];
}

export interface RecipeGuidanceInput {
  preferences: PreferenceDoc | null;
  recipe: RecipeDoc;
  feedbackSummary: FeedbackSummary;
}

function preferenceLine(prefs: PreferenceDoc | null): string | null {
  if (!prefs) return null;
  const likes = prefs.likes.filter((s) => s.trim().length > 0);
  const dislikes = prefs.dislikes.filter((s) => s.trim().length > 0);
  if (likes.length === 0 && dislikes.length === 0) return null;
  const parts: string[] = [];
  if (likes.length > 0) parts.push(`likes [${likes.join(', ')}]`);
  if (dislikes.length > 0) parts.push(`dislikes [${dislikes.join(', ')}]`);
  return `Preferences: ${parts.join('; ')}.`;
}

export function buildContextGuidance(input: ContextGuidanceInput): string[] {
  const out: string[] = [];
  if (input.recipes.length === 0) {
    out.push(
      'No recipes yet. Create a baseline recipe before asking for dial-in suggestions.'
    );
  } else {
    const newest = input.recipes[0];
    const s = newest.feedbackSummary;
    if (s.count === 0) {
      out.push(
        `Recent recipe ${newest.recipe.code} has no feedback yet; collect tasting notes before changing parameters.`
      );
    } else if (typeof s.averageOverall === 'number' && s.averageOverall < 3) {
      out.push(
        `${newest.recipe.code} average overall is below 3; inspect feedback comments and desired directions before repeating.`
      );
    }
  }
  const pref = preferenceLine(input.preferences);
  if (pref) out.push(pref);
  return out;
}

export function buildRecipeGuidance(input: RecipeGuidanceInput): string[] {
  const out: string[] = [];
  if (input.feedbackSummary.count === 0) {
    out.push(
      `Recipe ${input.recipe.code} has no feedback yet; collect tasting notes before changing parameters.`
    );
  } else if (
    typeof input.feedbackSummary.averageOverall === 'number' &&
    input.feedbackSummary.averageOverall < 3
  ) {
    out.push(
      `${input.recipe.code} average overall is below 3; inspect feedback comments and desired directions before repeating.`
    );
  }
  const pref = preferenceLine(input.preferences);
  if (pref) out.push(pref);
  return out;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/server/context.test.ts
```

Expected: all `summarizeFeedback`, `buildContextGuidance`, and `buildRecipeGuidance` tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/context.ts apps/web/src/lib/server/context.test.ts
git commit -m "feat(web): add deterministic context guidance helpers"
```

---

## Task 5: `buildRecentContext`

**Files:**
- Modify: `apps/web/src/lib/server/context.ts`
- Modify: `apps/web/src/lib/server/context.test.ts`

Composes `listRecentRecipes`, `listFeedbackForRecipe`, and `getGlobalPreferences`. Tests use the same `makeRouter` mocked-fetch pattern as `apps/web/src/lib/server/repositories/feedback.test.ts`.

- [ ] **Step 1: Append the failing tests**

Append to `apps/web/src/lib/server/context.test.ts`:

```ts
import type { CouchConfig } from './config';
import { buildRecentContext } from './context';

const couchConfig: CouchConfig = { url: 'http://127.0.0.1:5984', database: 'coffee' };

interface AllDocsRow<T> {
  id: string;
  key: string;
  value: { rev: string };
  doc: T;
}

function recipeRow(
  code: `COF-${string}`,
  createdAt: string,
  rev = '1-r'
): AllDocsRow<RecipeDoc> {
  return {
    id: `recipe:${code}`,
    key: `recipe:${code}`,
    value: { rev },
    doc: {
      _id: `recipe:${code}`,
      _rev: rev,
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

function feedbackRow(
  code: `COF-${string}`,
  createdAt: string,
  ratings: FeedbackDoc['ratings'] = {},
  extras: Partial<FeedbackDoc> = {}
): AllDocsRow<FeedbackDoc> {
  const id = `feedback:${code}:${createdAt}`;
  return {
    id,
    key: id,
    value: { rev: '1-f' },
    doc: {
      _id: id,
      _rev: '1-f',
      type: 'feedback',
      recipeCode: code,
      recipeId: `recipe:${code}`,
      ratings,
      source: 'web',
      createdAt,
      updatedAt: createdAt,
      ...extras
    }
  };
}

interface BuildFetchOptions {
  recipes: AllDocsRow<RecipeDoc>[];
  feedbackByCode?: Record<string, AllDocsRow<FeedbackDoc>[]>;
  preferences?: PreferenceDoc | null;
}

function buildFetch(opts: BuildFetchOptions): typeof fetch {
  const feedbackMap = opts.feedbackByCode ?? {};
  return (async (url: string) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);

    if (path === '/coffee/_all_docs') {
      const startkey = JSON.parse(u.searchParams.get('startkey') ?? '""') as string;
      if (startkey === 'recipe:') {
        return new Response(
          JSON.stringify({ total_rows: opts.recipes.length, offset: 0, rows: opts.recipes }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      const feedbackPrefix = startkey.match(/^feedback:(COF-[^:]+):$/);
      if (feedbackPrefix) {
        const code = feedbackPrefix[1];
        const rows = feedbackMap[code] ?? [];
        return new Response(
          JSON.stringify({ total_rows: rows.length, offset: 0, rows }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('unhandled startkey ' + startkey, { status: 500 });
    }

    if (path === '/coffee/preference:global') {
      if (opts.preferences === undefined || opts.preferences === null) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(opts.preferences), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response('unhandled ' + path, { status: 500 });
  }) as unknown as typeof fetch;
}

describe('buildRecentContext', () => {
  it('clamps limit (default 5, range 1..20)', async () => {
    const recipes = Array.from({ length: 25 }, (_, i) =>
      recipeRow(`COF-${String(i + 1).padStart(4, '0')}` as `COF-${string}`,
        `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z`)
    );
    const fetchImpl = buildFetch({ recipes, preferences: null });

    const defaulted = await buildRecentContext(couchConfig, undefined, fetchImpl);
    expect(defaulted.recentRecipes).toHaveLength(5);

    const tooSmall = await buildRecentContext(couchConfig, 0, fetchImpl);
    expect(tooSmall.recentRecipes).toHaveLength(1);

    const tooBig = await buildRecentContext(couchConfig, 99, fetchImpl);
    expect(tooBig.recentRecipes).toHaveLength(20);
  });

  it('returns recent recipes newest-first with attached feedback and totals', async () => {
    const recipes = [
      recipeRow('COF-0001', '2026-04-20T00:00:00Z'),
      recipeRow('COF-0002', '2026-04-22T00:00:00Z'),
      recipeRow('COF-0003', '2026-04-21T00:00:00Z')
    ];
    const feedbackByCode: Record<string, AllDocsRow<FeedbackDoc>[]> = {
      'COF-0002': [
        feedbackRow('COF-0002', '2026-04-23T00:00:00Z', { overall: 4 }, { comment: 'fine' })
      ],
      'COF-0001': [
        feedbackRow('COF-0001', '2026-04-21T00:00:00Z', { overall: 5 }),
        feedbackRow('COF-0001', '2026-04-22T00:00:00Z', { overall: 5 })
      ],
      'COF-0003': []
    };
    const fetchImpl = buildFetch({ recipes, feedbackByCode, preferences: null });

    const out = await buildRecentContext(couchConfig, 5, fetchImpl);
    expect(out.recentRecipes.map((r) => r.recipe.code)).toEqual([
      'COF-0002',
      'COF-0003',
      'COF-0001'
    ]);
    expect(out.recentRecipes[0].feedback).toHaveLength(1);
    expect(out.recentRecipes[0].feedbackSummary.averageOverall).toBe(4);
    expect(out.recentRecipes[2].feedbackSummary.averageOverall).toBe(5);
    expect(out.totals).toEqual({ recipes: 3, feedback: 3 });
    expect(out.preferences).toBeNull();
    expect(out.guidance).toEqual([]);
    expect(typeof out.generatedAt).toBe('string');
    // ISO-ish timestamp check
    expect(Number.isNaN(Date.parse(out.generatedAt))).toBe(false);
  });

  it('returns the no-recipes guidance string when there are no recipes', async () => {
    const fetchImpl = buildFetch({ recipes: [], preferences: null });
    const out = await buildRecentContext(couchConfig, 5, fetchImpl);
    expect(out.recentRecipes).toEqual([]);
    expect(out.totals).toEqual({ recipes: 0, feedback: 0 });
    expect(out.guidance).toContain(
      'No recipes yet. Create a baseline recipe before asking for dial-in suggestions.'
    );
  });

  it('includes preferences when present', async () => {
    const fetchImpl = buildFetch({
      recipes: [recipeRow('COF-0001', '2026-04-20T00:00:00Z')],
      feedbackByCode: { 'COF-0001': [] },
      preferences: prefs
    });
    const out = await buildRecentContext(couchConfig, 5, fetchImpl);
    expect(out.preferences?.likes).toEqual(['floral', 'citrus']);
    expect(out.guidance).toContain(
      'Preferences: likes [floral, citrus]; dislikes [bitter].'
    );
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/server/context.test.ts
```

Expected: vitest reports `buildRecentContext is not a function` (or a missing-export error). Earlier tests still pass.

- [ ] **Step 3: Append the implementation**

Replace the existing `@brewdial/shared` import block in `apps/web/src/lib/server/context.ts`:

```ts
import type {
  FeedbackDoc,
  FeedbackSummary,
  PreferenceDoc,
  RecipeDoc,
  RecipeWithFeedbackSummary
} from '@brewdial/shared';
```

with:

```ts
import type {
  ContextSummary,
  FeedbackDoc,
  FeedbackSummary,
  PreferenceDoc,
  RecipeDoc,
  RecipeWithFeedbackSummary
} from '@brewdial/shared';
import type { CouchConfig } from './config';
import { listRecentRecipes } from './repositories/recipes';
import { listFeedbackForRecipe } from './repositories/feedback';
import { getGlobalPreferences } from './repositories/preferences';
```

Then append at the end of the file:

```ts
const DEFAULT_CONTEXT_LIMIT = 5;
const MIN_CONTEXT_LIMIT = 1;
const MAX_CONTEXT_LIMIT = 20;

function clampContextLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_CONTEXT_LIMIT;
  const n = Math.floor(raw);
  if (n < MIN_CONTEXT_LIMIT) return MIN_CONTEXT_LIMIT;
  if (n > MAX_CONTEXT_LIMIT) return MAX_CONTEXT_LIMIT;
  return n;
}

export async function buildRecentContext(
  config: CouchConfig,
  limit?: number,
  fetchImpl?: typeof fetch
): Promise<ContextSummary> {
  const safeLimit = clampContextLimit(limit);
  const [recentRecipes, preferences] = await Promise.all([
    listRecentRecipes(config, safeLimit, fetchImpl),
    getGlobalPreferences(config, fetchImpl)
  ]);
  const enriched: RecipeWithFeedbackSummary[] = await Promise.all(
    recentRecipes.map(async (recipe) => {
      const feedback = await listFeedbackForRecipe(config, recipe.code, fetchImpl);
      return {
        recipe,
        feedback,
        feedbackSummary: summarizeFeedback(feedback)
      };
    })
  );
  const totals = {
    recipes: enriched.length,
    feedback: enriched.reduce((acc, r) => acc + r.feedback.length, 0)
  };
  const guidance = buildContextGuidance({ preferences, recipes: enriched });
  return {
    generatedAt: new Date().toISOString(),
    preferences,
    recentRecipes: enriched,
    totals,
    guidance
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/server/context.test.ts
```

Expected: all `buildRecentContext` tests pass; previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/context.ts apps/web/src/lib/server/context.test.ts
git commit -m "feat(web): add buildRecentContext service"
```

---

## Task 6: `buildRecipeContext`

**Files:**
- Modify: `apps/web/src/lib/server/context.ts`
- Modify: `apps/web/src/lib/server/context.test.ts`

Single-recipe context. Reuses `buildFetch` from Task 5 with an extra route for `getRecipeByCode`.

- [ ] **Step 1: Append the failing tests**

Append to `apps/web/src/lib/server/context.test.ts`:

```ts
import { buildRecipeContext } from './context';

interface SingleRecipeFetchOptions {
  recipe: AllDocsRow<RecipeDoc> | null; // null => 404 from getRecipeByCode
  feedback?: AllDocsRow<FeedbackDoc>[];
  preferences?: PreferenceDoc | null;
}

function buildSingleRecipeFetch(opts: SingleRecipeFetchOptions): typeof fetch {
  const fetchImpl = buildFetch({
    recipes: opts.recipe ? [opts.recipe] : [],
    feedbackByCode: opts.recipe
      ? { [opts.recipe.doc.code]: opts.feedback ?? [] }
      : {},
    preferences: opts.preferences ?? null
  });
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const recipeMatch = path.match(/^\/coffee\/recipe:(COF-[^/]+)$/);
    if (recipeMatch && (!init?.method || init.method === 'GET')) {
      if (!opts.recipe || opts.recipe.doc.code !== recipeMatch[1]) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(opts.recipe.doc), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return fetchImpl(url, init);
  }) as unknown as typeof fetch;
}

describe('buildRecipeContext', () => {
  it('returns null when the recipe does not exist', async () => {
    const fetchImpl = buildSingleRecipeFetch({ recipe: null });
    const out = await buildRecipeContext(couchConfig, 'COF-9999', fetchImpl);
    expect(out).toBeNull();
  });

  it('returns the full recipe context for an existing recipe', async () => {
    const fetchImpl = buildSingleRecipeFetch({
      recipe: recipeRow('COF-0001', '2026-04-20T00:00:00Z'),
      feedback: [
        feedbackRow('COF-0001', '2026-04-22T00:00:00Z', { overall: 4 }, {
          comment: 'great',
          desiredDirection: ['sweeter']
        })
      ],
      preferences: null
    });
    const out = await buildRecipeContext(couchConfig, 'COF-0001', fetchImpl);
    expect(out).not.toBeNull();
    expect(out!.recipe.code).toBe('COF-0001');
    expect(out!.feedback).toHaveLength(1);
    expect(out!.feedbackSummary.count).toBe(1);
    expect(out!.feedbackSummary.averageOverall).toBe(4);
    expect(out!.feedbackSummary.commonDesiredDirections).toEqual(['sweeter']);
    expect(out!.feedbackSummary.latestComment).toBe('great');
    expect(out!.guidance).toEqual([]);
    expect(typeof out!.generatedAt).toBe('string');
  });

  it('emits the no-feedback guidance hint when no feedback exists', async () => {
    const fetchImpl = buildSingleRecipeFetch({
      recipe: recipeRow('COF-0002', '2026-04-20T00:00:00Z'),
      feedback: [],
      preferences: null
    });
    const out = await buildRecipeContext(couchConfig, 'COF-0002', fetchImpl);
    expect(out!.guidance).toContain(
      'Recipe COF-0002 has no feedback yet; collect tasting notes before changing parameters.'
    );
  });

  it('emits the low-average guidance when averageOverall < 3', async () => {
    const fetchImpl = buildSingleRecipeFetch({
      recipe: recipeRow('COF-0003', '2026-04-20T00:00:00Z'),
      feedback: [
        feedbackRow('COF-0003', '2026-04-21T00:00:00Z', { overall: 2 }),
        feedbackRow('COF-0003', '2026-04-22T00:00:00Z', { overall: 3 })
      ],
      preferences: null
    });
    const out = await buildRecipeContext(couchConfig, 'COF-0003', fetchImpl);
    expect(out!.guidance).toContain(
      'COF-0003 average overall is below 3; inspect feedback comments and desired directions before repeating.'
    );
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/server/context.test.ts
```

Expected: vitest reports `buildRecipeContext is not a function`.

- [ ] **Step 3: Append the implementation**

Update the imports at the top of `apps/web/src/lib/server/context.ts` — replace the shared-types import block:

```ts
import type {
  ContextSummary,
  FeedbackDoc,
  FeedbackSummary,
  PreferenceDoc,
  RecipeDoc,
  RecipeWithFeedbackSummary
} from '@brewdial/shared';
import type { CouchConfig } from './config';
import { listRecentRecipes } from './repositories/recipes';
import { listFeedbackForRecipe } from './repositories/feedback';
import { getGlobalPreferences } from './repositories/preferences';
```

with:

```ts
import type {
  ContextSummary,
  FeedbackDoc,
  FeedbackSummary,
  PreferenceDoc,
  RecipeCode,
  RecipeContext,
  RecipeDoc,
  RecipeWithFeedbackSummary
} from '@brewdial/shared';
import type { CouchConfig } from './config';
import { getRecipeByCode, listRecentRecipes } from './repositories/recipes';
import { listFeedbackForRecipe } from './repositories/feedback';
import { getGlobalPreferences } from './repositories/preferences';
```

Then append at the end of the file:

```ts
export async function buildRecipeContext(
  config: CouchConfig,
  code: RecipeCode,
  fetchImpl?: typeof fetch
): Promise<RecipeContext | null> {
  const recipe = await getRecipeByCode(config, code, fetchImpl);
  if (!recipe) return null;
  const [feedback, preferences] = await Promise.all([
    listFeedbackForRecipe(config, code, fetchImpl),
    getGlobalPreferences(config, fetchImpl)
  ]);
  const feedbackSummary = summarizeFeedback(feedback);
  const guidance = buildRecipeGuidance({ preferences, recipe, feedbackSummary });
  return {
    generatedAt: new Date().toISOString(),
    preferences,
    recipe,
    feedback,
    feedbackSummary,
    guidance
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @brewdial/web exec vitest run src/lib/server/context.test.ts
```

Expected: all `buildRecipeContext` tests pass; full file passes.

- [ ] **Step 5: Run full type-check across workspaces**

```bash
pnpm check
```

Expected: `0 errors / 0 warnings`. (Confirms imports of new shared types compile against `@brewdial/shared`.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/context.ts apps/web/src/lib/server/context.test.ts
git commit -m "feat(web): add buildRecipeContext service"
```

---

## Task 7: `GET /api/context` route

**Files:**
- Create: `apps/web/src/routes/api/context/+server.ts`

Thin wrapper. Service-level tests cover the logic; this route is responsible only for `?limit` clamping, JSON shaping, and safe `503` on failure.

- [ ] **Step 1: Create the route file**

Create `apps/web/src/routes/api/context/+server.ts` with:

```ts
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  type ApiErrorResponse,
  type ContextSummaryResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { buildRecentContext } from '$lib/server/context';

const DEFAULT_CONTEXT_LIMIT = 5;
const MAX_CONTEXT_LIMIT = 20;

function clampContextLimit(raw: string | null): number {
  if (!raw) return DEFAULT_CONTEXT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONTEXT_LIMIT;
  return Math.min(MAX_CONTEXT_LIMIT, n);
}

function couchUnreachable(): Response {
  const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
  return json(body, { status: 503 });
}

export const GET = async ({ url }: { url: URL }) => {
  const config = getServerConfig(env);
  const limit = clampContextLimit(url.searchParams.get('limit'));
  try {
    const context = await buildRecentContext(config.couch, limit);
    const body: ContextSummaryResponse = { context };
    return json(body);
  } catch {
    return couchUnreachable();
  }
};
```

- [ ] **Step 2: Run type-check and tests**

```bash
pnpm check
pnpm --filter @brewdial/web exec vitest run src/lib/server/context.test.ts
```

Expected: both succeed (route file compiles; existing service tests still pass).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/api/context/+server.ts
git commit -m "feat(web): add GET /api/context route"
```

---

## Task 8: `GET /api/context/[code]` route

**Files:**
- Create: `apps/web/src/routes/api/context/[code]/+server.ts`

Mirrors the convention of `apps/web/src/routes/api/recipes/[code]/+server.ts`: `400` for invalid code, `404` for missing recipe, `503` for CouchDB failure.

- [ ] **Step 1: Create the route file**

Create `apps/web/src/routes/api/context/[code]/+server.ts` with:

```ts
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  isRecipeCode,
  type ApiErrorResponse,
  type RecipeContextResponse
} from '@brewdial/shared';
import { getServerConfig } from '$lib/server/config';
import { buildRecipeContext } from '$lib/server/context';

export const GET = async ({ params }: { params: { code: string } }) => {
  const config = getServerConfig(env);
  const code = params.code;
  if (!isRecipeCode(code)) {
    const body: ApiErrorResponse = { ok: false, error: 'Invalid recipe code' };
    return json(body, { status: 400 });
  }
  try {
    const context = await buildRecipeContext(config.couch, code);
    if (!context) {
      const body: ApiErrorResponse = { ok: false, error: 'Recipe not found' };
      return json(body, { status: 404 });
    }
    const body: RecipeContextResponse = { context };
    return json(body);
  } catch {
    const body: ApiErrorResponse = { ok: false, error: 'CouchDB unreachable' };
    return json(body, { status: 503 });
  }
};
```

- [ ] **Step 2: Run type-check and tests**

```bash
pnpm check
pnpm --filter @brewdial/web exec vitest run
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/api/context/[code]/+server.ts
git commit -m "feat(web): add GET /api/context/[code] route"
```

---

## Task 9: README + ADR 0005

**Files:**
- Modify: `README.md`
- Create: `docs/decisions/0005-agent-context-api.md`

- [ ] **Step 1: Update the Status section in `README.md`**

Open `README.md`. Replace the `## Status` block:

```md
## Status

**CouchDB foundation (PR2).** Monorepo skeleton plus a server-only CouchDB
client, `/api/health` and `/api/db/health` endpoints, and bootstrap/health
scripts. MCP server, auth, and deployment are intentionally deferred to
later PRs.
```

with:

```md
## Status

**Agent Context API (PR6).** Monorepo skeleton, server-only CouchDB client
(PR2 / PR3), Recipe / Feedback JSON API (PR4), Mobile UI MVP (PR5), and now a
read-only Agent Context Summary API. MCP server, auth, and deployment are
intentionally deferred to later PRs.
```

- [ ] **Step 2: Append the Agent Context API section**

Append to `README.md` (immediately before the existing `## License` section):

```md
## Agent Context API

PR6 adds a read-only summary API for agents and MCP clients. It returns
structured context — recent recipes, attached feedback, derived feedback
summaries, global preferences, and a small list of deterministic guidance
hints — without calling an LLM. CouchDB must be running and bootstrapped
(`pnpm db:bootstrap`).

```bash
# Recent context (default limit 5, clamped to 1..20)
curl 'http://localhost:5173/api/context?limit=5'

# Single-recipe context
curl http://localhost:5173/api/context/COF-0001
```

Errors are safe JSON (`400 Invalid recipe code`, `404 Recipe not found`,
`503 CouchDB unreachable`) and never include CouchDB credentials, raw error
bodies, or stack traces. See `docs/decisions/0005-agent-context-api.md` for
the rationale and non-goals.
```

- [ ] **Step 3: Create ADR 0005**

Create `docs/decisions/0005-agent-context-api.md` with:

```md
# 0005 — Agent Context Summary API

## Status

Accepted (PR6, Agent Context Summary API).

## Context

PR4 landed the Recipe / Feedback JSON API and PR5 added a mobile UI on top of
it. Future agents (Hermes, OpenClaw, others) and a future MCP server will
need a compact, structured "what has the user been brewing lately" surface
before suggesting the next dial-in. PR6 ships that as a read-only HTTP API,
without committing to an LLM, an MCP server, auth, or any deployment story
yet.

## Decision

### Why a read-only context API comes before MCP

- Building MCP first would couple the protocol surface to whatever in-memory
  shape the model happened to want. Shipping an HTTP context contract first
  pins the data shape down and makes it agent-agnostic.
- An HTTP endpoint is testable today against mocked `fetch`; an MCP server
  pulls in a separate transport, schema language, and process-management
  story that the API does not need.
- Once the context shape is stable, an MCP server becomes a thin wrapper
  that re-exposes the same data via tool calls.

### Why deterministic structured context instead of an LLM

- The whole point of this PR is to give agents the raw material they already
  needed before suggesting a brew. Inserting an LLM here would just hide
  data behind a model hop and add a key-management story the project does
  not want.
- Deterministic guidance strings (no recipes yet / latest recipe lacks
  feedback / latest average overall is below 3) are reproducible, cheap to
  test, and safe to ship without auth.
- LLM-driven recommendation can live on top of this API later, in a
  separate component, without changing the contract.

### Why no auth in PR6

- BrewDial is still a single-user MacBook tool; the public domain
  (`coffee.robinco.dev`) is planned but not yet served.
- Adding auth now would lock in a session/identity shape we would have to
  redo when MCP / OAuth / agent identity lands.
- The CouchDB credentials in `apps/web/src/lib/server/config.ts` remain the
  only secret today; the new endpoints continue to redact configuration and
  raw errors from responses.

### Why no Mango indexes / `_design` docs in PR6

- `_all_docs` prefix ranges (the same approach PR4 chose) are still fast
  enough at MVP scale and require zero index management.
- A Mango index needs a `_design` document plus a migration story; deferring
  that to the first query that genuinely needs it keeps the PR small.
- The `/api/context` endpoint reads at most 20 recent recipes plus their
  feedback, so a sequential scan is fine for now.

## Non-goals (PR6)

- No LLM calls, prompts, or model wiring.
- No MCP server or package.
- No auth, sessions, cookies, or rate limiting.
- No PouchDB or offline sync.
- No deployment, launchd, or Cloudflare configuration.
- No new runtime validation libraries (no `zod`).
- No CouchDB SDK, Mango indexes, or `_design` docs.
- No UI pages for the context endpoints.
```

- [ ] **Step 4: Verify docs build / type-check still clean**

```bash
pnpm check
```

Expected: `0 errors / 0 warnings`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/decisions/0005-agent-context-api.md
git commit -m "docs: document agent context API and add ADR 0005"
```

---

## Task 10: Full validation and optional smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full validation suite**

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm lint
```

Expected: every command exits 0. `pnpm test` runs `vitest run` in `@brewdial/web` (and any tests in `@brewdial/shared`); the new `context.test.ts` is included via the `src/**/*.test.ts` pattern in `apps/web/vitest.config.ts`. `pnpm lint` is the existing intentional no-op.

- [ ] **Step 2: (Optional) Local CouchDB smoke test**

Only run this if a local CouchDB is already up and bootstrapped (`pnpm db:health` succeeds and `pnpm db:bootstrap` has been run at least once). Skip otherwise — automated tests already cover the deterministic behavior.

```bash
pnpm db:health
pnpm dev -- --host 127.0.0.1
```

In a separate terminal:

```bash
curl 'http://localhost:5173/api/context?limit=5'
curl http://localhost:5173/api/context/COF-0001
curl -i http://localhost:5173/api/context/NOT-A-CODE
curl -i http://localhost:5173/api/context/COF-9999
```

Expected:
- `?limit=5` returns `200` with `{ context: { ... } }`.
- `COF-0001` (assumed-existing) returns `200` with `{ context: { ... } }`.
- `NOT-A-CODE` returns `400` with `{ ok: false, error: 'Invalid recipe code' }`.
- `COF-9999` (assumed-missing) returns `404` with `{ ok: false, error: 'Recipe not found' }`.

Stop the dev server (`Ctrl-C`) afterwards.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/agent-context-api
```

Expected: branch `feat/agent-context-api` is published to `origin`.

- [ ] **Step 4: Open the PR**

Open the PR against `main` using this body (matches the source-prompt template):

```md
## Summary
- Added read-only Agent Context Summary API (`GET /api/context`, `GET /api/context/[code]`)
- Added deterministic feedback summary + guidance helpers in `apps/web/src/lib/server/context.ts`
- Added shared response types in `@brewdial/shared`
- Documented Agent Context API in README and ADR 0005

## Validation
- [x] pnpm install --frozen-lockfile
- [x] pnpm check
- [x] pnpm build
- [x] pnpm test
- [x] pnpm lint
- [ ] live CouchDB smoke: /api/context and /api/context/COF-0001 (optional; skipped when CouchDB not running)

## Test scope
Service-level integration tests (`apps/web/src/lib/server/context.test.ts`) cover all error/branch behavior with mocked `fetch`. Per the design spec fallback, route handlers are thin wrappers and have no separate test files.

## Non-goals
- No LLM calls
- No MCP server
- No auth/session/rate limiting
- No deployment changes
- No offline sync
```

Expected: PR opens against `main`, CI (none configured yet) is not blocking.

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-04-27-agent-context-api-design.md` is mapped to a task here:
  - Resolved decisions 1, 2 → routes in T7/T8 use `lib/server/context.ts` and 400-on-invalid-code.
  - Resolved decisions 3–6 (deterministic guidance, averageOverall, common directions, latest comment) → T3 + T4 tests assert each rule.
  - Resolved decision 7 (mocked-fetch only) → T5/T6 use mocked `fetch`; no live CouchDB required by automated tests; smoke test in T10 is explicitly optional.
  - Shared response types → T2.
  - Service module → T3–T6.
  - API routes → T7/T8.
  - Error matrix → T7 (503), T8 (400/404/503).
  - Documentation → T9.
  - Validation gate → T10.
- **Placeholders:** none — every step contains exact code, exact commands, and expected output.
- **Type / signature consistency:** the `summarizeFeedback`, `buildContextGuidance`, `buildRecipeGuidance`, `buildRecentContext`, and `buildRecipeContext` signatures used in the route files (T7/T8) and tests (T3–T6) match the implementations introduced in T3–T6 exactly. Shared interfaces (`FeedbackSummary`, `RecipeWithFeedbackSummary`, `ContextSummary`, `ContextSummaryResponse`, `RecipeContext`, `RecipeContextResponse`) are defined once in T2 and imported the same way everywhere.
