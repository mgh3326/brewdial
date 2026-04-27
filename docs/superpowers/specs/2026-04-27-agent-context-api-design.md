# PR6 — Agent Context Summary API Design

**Date:** 2026-04-27
**Status:** Approved (decisions resolved 2026-04-27)
**Source prompt:** `brewdial-pr6-agent-context-summary-api.md` (passed in by the user; not committed under the repo)

## Goal

Add a read-only **Agent Context Summary API** that returns structured,
agent-friendly coffee context from existing CouchDB-backed recipes, feedback,
and global preferences. The API must be useful to future agents and MCP
clients without calling an LLM and without expanding the project's auth,
deployment, or offline-sync surface.

This PR is API-only. New endpoints are layered on top of the existing
repositories from PR4. No UI is added.

## Resolved Decisions

These resolve open points in the source prompt:

1. **Context module location:** `apps/web/src/lib/server/context.ts` (service
   level, alongside `config.ts` / `couch.ts` / `errors.ts`). The module is a
   service that *composes* recipes, feedback, and preferences; it is not a
   single-document repository, so it does not belong under
   `apps/web/src/lib/server/repositories/`.
2. **Invalid recipe code response:** `400 { ok: false, error: 'Invalid recipe code' }`
   — same convention used by `apps/web/src/routes/api/recipes/[code]/+server.ts`.
   Missing recipe stays `404 { ok: false, error: 'Recipe not found' }`. CouchDB
   unreachable stays `503 { ok: false, error: 'CouchDB unreachable' }`.
3. **Guidance scope:** deterministic, conservative, human-readable hints only.
   No model calls, no scoring heuristics beyond simple count/threshold checks
   in this PR.
4. **`FeedbackSummary.averageOverall`:** average of `ratings.overall` values
   across feedback that *has* `overall` defined; `null` when no such feedback
   exists. Round to at most 2 decimals.
5. **`commonDesiredDirections`:** drop empty / whitespace-only entries, trim,
   deduplicate, and order by frequency first then first-appearance order
   (stable tiebreak).
6. **`latestComment`:** the `comment` from the newest feedback (by
   `createdAt`) that has a non-empty `comment`; `null` otherwise.
7. **Tests:** mocked-fetch unit and integration coverage only. Live CouchDB is
   never required by automated tests, even though a local CouchDB is now
   bootstrapped for manual smoke testing.

## Constraints (carried from source prompt)

- **Agent-agnostic:** no Hermes-specific naming in code, package names,
  field names, or docs.
- **Stack:** pnpm monorepo, SvelteKit + TypeScript, plain CSS, CouchDB via
  server-only `fetch`, shared types in `@brewdial/shared`. No new runtime
  validation libraries (no `zod`).
- **No LLM** calls, prompts, or model wiring.
- **No MCP** server or package in this PR.
- **No auth / sessions / rate limiting.**
- **No PouchDB / offline sync.**
- **No deployment** changes (no launchd, no Cloudflare).
- **No CouchDB SDK, Mango indexes, or design docs.**
- **No UI pages** for the new context endpoints.
- **No raw secrets, config values, stack traces, or local paths** in API
  responses or in committed implementation plans.

## Scope

Endpoints (all `GET`, JSON):

```text
GET /api/context
GET /api/context?limit=5
GET /api/context/COF-0001
```

### `GET /api/context`

Compact summary of recent brew activity, suitable for an agent to read before
suggesting the next brew.

Response body:

```ts
interface ContextSummaryResponse {
  context: {
    generatedAt: string;          // ISO timestamp
    preferences: PreferenceDoc | null;
    recentRecipes: RecipeWithFeedbackSummary[];
    totals: {
      recipes: number;            // count returned in this response
      feedback: number;           // total feedback rows attached to those recipes
    };
    guidance: string[];
  };
}
```

Behavior:

- `limit` query param defaults to `5`.
- Clamp `limit` to `1..20` for context endpoints, even though
  `listRecentRecipes` allows up to `100`.
- Recent recipes come from `listRecentRecipes` (newest-first).
- For each returned recipe, attach feedback from `listFeedbackForRecipe` plus
  a derived `feedbackSummary`.
- Preferences come from `getGlobalPreferences`; return `null` when absent.
- `totals.recipes` is `recentRecipes.length` (not the total CouchDB count).
- `totals.feedback` is the sum of `feedback.length` across `recentRecipes`.
- CouchDB unreachable → safe `503 { ok: false, error: 'CouchDB unreachable' }`.
- No raw error bodies, stack traces, credentials, or local paths in the
  response.

### `GET /api/context/[code]`

Context for a single recipe code.

Response body:

```ts
interface RecipeContextResponse {
  context: {
    generatedAt: string;
    preferences: PreferenceDoc | null;
    recipe: RecipeDoc;
    feedback: FeedbackDoc[];
    feedbackSummary: FeedbackSummary;
    guidance: string[];
  };
}
```

Behavior:

- Validate the code with the existing `isRecipeCode`.
- Invalid code → `400 { ok: false, error: 'Invalid recipe code' }`.
- No recipe with that code → `404 { ok: false, error: 'Recipe not found' }`.
- CouchDB unreachable → `503 { ok: false, error: 'CouchDB unreachable' }`.

## Architecture

Layered, mirroring the PR4 API:

```text
SvelteKit +server.ts route handlers
  /api/context          -> apps/web/src/routes/api/context/+server.ts
  /api/context/[code]   -> apps/web/src/routes/api/context/[code]/+server.ts
        |
        v
Context service           apps/web/src/lib/server/context.ts
  - summarizeFeedback
  - buildContextGuidance
  - buildRecentContext
  - buildRecipeContext
        |
        v
Existing repositories     apps/web/src/lib/server/repositories/
  - listRecentRecipes
  - getRecipeByCode
  - listFeedbackForRecipe
  - getGlobalPreferences
        |
        v
Existing CouchDB client   apps/web/src/lib/server/couch.ts
```

The service module never reaches into CouchDB directly; it only calls
existing repository helpers and pure functions.

### Shared response types

`packages/shared/src/api-types.ts` gains exported response/context interfaces.
`RecipeDoc`, `FeedbackDoc`, and `PreferenceDoc` are reused as nested domain
objects — no duplicate shapes.

```ts
import type { PreferenceDoc, RecipeDoc, FeedbackDoc } from './types';

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

The new types are re-exported from `@brewdial/shared` via
`packages/shared/src/index.ts` (already re-exports `api-types`). Imports must
not duplicate symbols and must keep `pnpm check` clean.

### Context service module

`apps/web/src/lib/server/context.ts` exposes:

```ts
export function summarizeFeedback(feedback: FeedbackDoc[]): FeedbackSummary;

export interface ContextGuidanceInput {
  preferences: PreferenceDoc | null;
  recipes: RecipeWithFeedbackSummary[];
}
export function buildContextGuidance(input: ContextGuidanceInput): string[];

export interface RecipeGuidanceInput {
  preferences: PreferenceDoc | null;
  recipe: RecipeDoc;
  feedbackSummary: FeedbackSummary;
}
export function buildRecipeGuidance(input: RecipeGuidanceInput): string[];

export async function buildRecentContext(
  config: CouchConfig,
  limit?: number,
  fetchImpl?: typeof fetch
): Promise<ContextSummary>;

export async function buildRecipeContext(
  config: CouchConfig,
  code: RecipeCode,
  fetchImpl?: typeof fetch
): Promise<RecipeContext | null>;
```

Implementation notes:

- `summarizeFeedback`:
  - `count`: `feedback.length`.
  - `latestAt`: max `createdAt` across feedback, or `null` when empty.
  - `averageOverall`: average of `ratings.overall` over feedback that has
    `overall` defined; `null` when no feedback has it. Round to ≤ 2 decimals
    (`Math.round(x * 100) / 100`).
  - `commonDesiredDirections`: flatten all `desiredDirection` arrays; trim
    each entry; drop empties; count occurrences; sort by `count desc, first
    appearance asc`; output the keys.
  - `latestComment`: among feedback with non-empty trimmed `comment`, take
    the one with the largest `createdAt`; output its (untrimmed) comment, or
    `null`.
- `buildContextGuidance` produces deterministic strings such as:
  - No recipes: `"No recipes yet. Create a baseline recipe before asking for dial-in suggestions."`
  - Most recent recipe has zero feedback: `"Recent recipe COF-0001 has no feedback yet; collect tasting notes before changing parameters."`
  - Most recent recipe with feedback has `averageOverall` defined and `< 3`:
    `"COF-0001 average overall is below 3; inspect feedback comments and desired directions before repeating."`
  - Preferences with non-empty `likes` and/or `dislikes`: a single-line
    summary, e.g. `"Preferences: likes [floral, citrus]; dislikes [bitter]."`
- `buildRecipeGuidance` runs the same checks against a single recipe.
- `buildRecentContext` clamps `limit` (default `5`, range `1..20`), then calls
  `listRecentRecipes`, `listFeedbackForRecipe` per recipe, and
  `getGlobalPreferences`. It computes `totals` from the returned data and
  attaches `guidance`.
- `buildRecipeContext` calls `getRecipeByCode`, returns `null` when missing,
  otherwise calls `listFeedbackForRecipe` and `getGlobalPreferences`.
- All async helpers accept an optional `fetchImpl` for tests, matching the
  PR4 repository pattern.

The service is intentionally not "smart". It packages context; it does not
generate recommendations.

### API routes

`apps/web/src/routes/api/context/+server.ts`:

- Accepts `?limit=` (string, optional).
- Parses with the existing `clampLimit` style but uses `MAX_CONTEXT_LIMIT = 20`
  and `DEFAULT_CONTEXT_LIMIT = 5`.
- Calls `buildRecentContext` and returns `200 { context }`.
- Catches all errors and responds with the safe `503 CouchDB unreachable`
  body. Does not log raw error fields back to the response.

`apps/web/src/routes/api/context/[code]/+server.ts`:

- `isRecipeCode(params.code)` gate → `400 Invalid recipe code` on failure.
- `buildRecipeContext` → `200 { context }` or `404 Recipe not found`.
- All other failures → `503 CouchDB unreachable`.

Both routes use `json` from `@sveltejs/kit`, `env` from
`$env/dynamic/private`, `getServerConfig(env)`, and `ApiErrorResponse` for
errors — same shape as PR4 routes.

### Data flow

```text
GET /api/context?limit=N
  -> +server.ts clamps limit to 1..20
  -> buildRecentContext(config, limit)
       -> listRecentRecipes -> RecipeDoc[]
       -> listFeedbackForRecipe (per recipe) -> FeedbackDoc[]
       -> getGlobalPreferences -> PreferenceDoc | null
       -> summarizeFeedback (per recipe)
       -> buildContextGuidance
  -> JSON: { context: ContextSummary }

GET /api/context/COF-XXXX
  -> +server.ts validates code
  -> buildRecipeContext(config, code)
       -> getRecipeByCode -> RecipeDoc | null
       -> listFeedbackForRecipe -> FeedbackDoc[]
       -> getGlobalPreferences -> PreferenceDoc | null
       -> summarizeFeedback
       -> buildRecipeGuidance
  -> JSON: { context: RecipeContext }
     | 400 invalid | 404 not found | 503 unreachable
```

### Error handling

Single matrix for both routes:

| Condition                                  | Status | Body                                          |
| ------------------------------------------ | ------ | --------------------------------------------- |
| Success                                    | 200    | `{ context: ... }`                            |
| Invalid recipe code (single-recipe route)  | 400    | `{ ok: false, error: 'Invalid recipe code' }` |
| Unknown recipe (single-recipe route)       | 404    | `{ ok: false, error: 'Recipe not found' }`    |
| CouchDB unreachable / unexpected throw     | 503    | `{ ok: false, error: 'CouchDB unreachable' }` |

Routes never include `details` or raw error messages from CouchDB. Logs may
contain the underlying error, but the response must not.

### Testing strategy

All automated tests use mocked `fetch` against the existing CouchDB client
contract. They must run without a live CouchDB.

- `apps/web/src/lib/server/context.test.ts` — unit/integration tests for the
  service module:
  - `summarizeFeedback` covers count, latestAt, averageOverall (including
    no-`overall` case), commonDesiredDirections (trim/dedupe/frequency
    order), and latestComment selection.
  - `buildRecentContext` covers limit clamping (`0` → `1`, `99` → `20`,
    default → `5`), preferences null vs. populated, totals computation,
    feedback attachment, and guidance triggers.
  - `buildRecipeContext` covers missing recipe (`null` return), populated
    feedback summary, and guidance triggers.
- `apps/web/src/routes/api/context/server.test.ts` — route-level tests:
  - 200 path with mocked CouchDB returning recipes and feedback.
  - 503 path when mocked fetch rejects.
- `apps/web/src/routes/api/context/[code]/server.test.ts` — route-level
  tests:
  - 200 for valid existing recipe.
  - 404 for valid code with no matching recipe.
  - 400 for invalid code.
  - 503 when mocked fetch rejects.

If route tests prove awkward to wire (e.g. SvelteKit handler invocation
quirks), keep integration coverage at the service layer and trim route tests
to status/error assertions only — but every error branch in the matrix above
must still be covered somewhere.

### Documentation updates

- `README.md`:
  - Update status so it no longer says only "CouchDB foundation (PR2)".
    Mention Mobile UI MVP (PR5) and the new Agent Context API.
  - Add an `Agent Context API` section with `curl` examples:

    ```bash
    curl 'http://localhost:5173/api/context?limit=5'
    curl http://localhost:5173/api/context/COF-0001
    ```
- `docs/decisions/0005-agent-context-api.md` (new ADR):
  - Why a read-only context API comes before MCP.
  - Why the API returns deterministic structured context instead of calling
    an LLM.
  - Why no auth in this PR.
  - Why no Mango indexes / design docs in this PR.
  - Non-goals matching this PR.
- An implementation plan under `docs/superpowers/plans/` is allowed but must
  stay generic — no local absolute paths, no machine-specific names.

## Validation

After implementation, the following must succeed from the repo root:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm lint
```

Optional manual smoke test against a local CouchDB (not required by CI):

```bash
pnpm db:health
pnpm dev -- --host 127.0.0.1
curl 'http://localhost:5173/api/context?limit=5'
curl http://localhost:5173/api/context/COF-0001
```

Stop the dev server afterwards.

## Acceptance criteria

- `GET /api/context` returns deterministic structured context per the schema
  above.
- `GET /api/context/COF-XXXX` works for existing recipe codes.
- Safe JSON errors for missing recipe (`404`), invalid code (`400`), and
  CouchDB unreachable (`503`).
- No raw secrets, config values, or stack traces are present in any API
  response.
- Automated tests pass without live CouchDB.
- `pnpm install --frozen-lockfile && pnpm check && pnpm build && pnpm test &&
  pnpm lint` all succeed.
- README and ADR 0005 document the new API and its non-goals.
- PR remains narrowly scoped: no LLM, no MCP, no auth, no deployment, no
  offline sync.

## Git workflow

1. Sync `main` and branch:

   ```bash
   git checkout main
   git pull --ff-only
   git checkout -b feat/agent-context-api
   ```

2. Commit logically by task (shared types → service → routes → docs).
3. Push: `git push -u origin feat/agent-context-api`.
4. Open PR against `main` using the PR description template from the source
   prompt.

If, during implementation, a small adjustment to this design is needed (e.g.
a guidance string the user prefers to phrase differently, or a test split
that fits the route harness better), make the smallest possible change and
record it in the PR description rather than expanding scope.

## Non-goals (PR6)

- No LLM calls, prompts, or model wiring.
- No MCP server or package.
- No auth, sessions, cookies, or rate limiting.
- No PouchDB or offline sync.
- No deployment, launchd, or Cloudflare configuration.
- No new runtime validation libraries (no `zod`).
- No CouchDB SDK or Mango indexes / design docs.
- No UI pages for context endpoints.
- No Hermes-specific naming, comments, or assumptions.
