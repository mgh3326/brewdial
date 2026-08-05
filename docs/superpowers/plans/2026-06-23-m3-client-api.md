# M3 — 클라이언트 API (reads + writes + /me) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the BrewDial backend's **client-facing HTTP API** on the M2 foundation — every read/write the mini-app + web currently make against Supabase, plus the identity-scoped `/api/me/*` personalization surface — returning the exact row shapes the existing client mappers consume.

**Architecture:** `routes (Hono, apps/api)` → `services (apps/api, write logic/authz)` → `repositories (packages/db, SQL via Kysely)` → `db`. Anonymous identity arrives in an `X-BrewDial-Identity` header, resolved server-side via the ported `resolve_app_user`. Personalization RPC logic (save/collections/gear/calibration) is **reimplemented in TS services** (per Spec 1 §4.4) — the snapshot capture stays a server-side SQL `to_jsonb`. Owner/official columns are server-controlled and never read from request bodies.

**Tech Stack:** Node 22 (ESM, NodeNext), TS, Hono, Kysely + `pg`, Vitest, local Homebrew PostgreSQL 17 (no Docker). Builds on `@brewdial/db` (migrations 001/002/003 applied) + `@brewdial/api` (Hono app + health) from M2.

## Global Constraints

- **Response-shape parity (load-bearing):** read endpoints return rows whose columns match what the existing client mappers consume — `RECIPE_COLUMNS` / `FEEDBACK_COLUMNS` and the `bean_summaries` view columns, **snake_case**, null-vs-absent preserved. Find the exact column lists in `apps/miniapp/src/lib/data/mappers.ts` (and `apps/mcp/src/mappers.ts`); project those columns (do not invent or rename). `GET /api/me/collections` returns the **camelCase composite** `{ savedRecipes, savedBeans, gear, calibration, myRecipes }` shape that the old `rpc_my_collections` returned (see `apps/miniapp/src/lib/data/user-content.ts`).
- **Identity wire-contract:** header `X-BrewDial-Identity: <provider>:<externalKey>` where `provider ∈ {toss_anon, web_local}` and `externalKey` is the client's anon key (≥16 chars). Server resolves it via `resolve_app_user(provider, externalKey)` and scopes all `/me/*` queries by the resolved `app_user_id`. Missing/malformed header on a `/me/*` route → `401`. (Spec 2 swaps the source for a backend session without changing routes.)
- **Server controls ownership:** `owner_id`, `is_official`, `created_by` are NEVER read from a request body. Manual recipe inserts set `created_by='manual'` server-side and leave `owner_id` NULL; the `bd_guard_recipe_owner_immutable` trigger enforces this. Anonymous clients may create only manual recipes / `web` feedback (agent/official is the M4 agent surface).
- **Filtering/limits preserved:** `listRecentRecipes` clamps limit to 1..100 (default 20), `status='active'`; `getRecipeByCode` excludes `status='test'`; `listRecipesByBean` is `bean_id=? AND status='active'`; `listBeans` is `recipe_count>0` ordered by `latest_recipe_at desc`.
- Node >=22, ESM, NodeNext, ES2022. DB tests share local `brewdial_test`; vitest `fileParallelism:false` (already set in both workspaces). Re-run-safe seeds (unique ids / cleanup).
- **No DB-business-logic in Postgres beyond what M2 kept:** do NOT add new SQL functions for save/collections/gear/calibration — implement them as TS services using plain queries (the snapshot capture is a `to_jsonb` in a single insert query, not a new stored function).

---

## File Structure

**`packages/db/src/repositories/`** (SQL only, typed via Kysely `DB`):
- `recipes.ts` — `listRecentRecipes`, `getRecipeByCode`, `listRecipesByBean`, `insertManualRecipe`, `getOwnedRecipeCodes`
- `beans.ts` — `listBeans`, `getBean` (from `bean_summaries`)
- `feedback.ts` — `listFeedbackByRecipe`, `insertFeedback`
- `registries.ts` — `listGrinders`, `listDrippers` (exists from M2)
- `collections.ts` — `getSavedRecipes`, `getSavedBeans`, `getGear`, `getCalibration` (reads for the composite)
- `saved.ts` — `saveRecipe` (snapshot-capture insert), `saveBean`
- `gear.ts` — `upsertGear` (default-clearing), `upsertCalibration`
- `identity.ts` — `resolveAppUser(db, provider, externalKey)` (wraps `select resolve_app_user($1,$2)`)

**`apps/api/src/`**:
- `middleware/identity.ts` — parse `X-BrewDial-Identity`, resolve, attach `appUserId` to context; `requireIdentity` for `/me/*`
- `routes/recipes.ts`, `routes/beans.ts`, `routes/registries.ts`, `routes/feedback.ts`, `routes/me.ts`
- `services/collections.ts` — assemble the composite; `services/save.ts` — save/gear/calibration orchestration
- `app.ts` — mount all routers under `/api`

---

### Task 1: Identity middleware + repository

**Files:**
- Create: `packages/db/src/repositories/identity.ts`
- Create: `apps/api/src/middleware/identity.ts`
- Test: `apps/api/src/middleware/identity.test.ts`

**Interfaces:**
- Produces: `resolveAppUser(db, provider, externalKey): Promise<string>` (returns app_user_id uuid). `identityMiddleware` (sets `c.set('appUserId', id|undefined)`), `requireIdentity` (401 if no identity).

- [ ] **Step 1: repository** — `packages/db/src/repositories/identity.ts`
```ts
import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'
export async function resolveAppUser(db: Kysely<DB>, provider: string, externalKey: string): Promise<string> {
  const r = await sql<{ resolve_app_user: string }>`select resolve_app_user(${provider}, ${externalKey}) as resolve_app_user`.execute(db)
  return r.rows[0].resolve_app_user
}
```

- [ ] **Step 2: failing middleware test** — `apps/api/src/middleware/identity.test.ts`
```ts
import { Hono } from 'hono'
import { expect, test } from 'vitest'
import { identityMiddleware, requireIdentity } from './identity.js'

function appUnderTest() {
  const app = new Hono()
  app.use('*', identityMiddleware)
  app.get('/pub', (c) => c.json({ id: c.get('appUserId') ?? null }))
  app.get('/me/x', requireIdentity, (c) => c.json({ id: c.get('appUserId') }))
  return app
}
const KEY = 'toss_anon:idmwtestkey_' + '0'.repeat(20)

test('resolves a valid identity header to an app_user id', async () => {
  const res = await appUnderTest().request('/pub', { headers: { 'X-BrewDial-Identity': KEY } })
  const body = await res.json()
  expect(typeof body.id).toBe('string'); expect(body.id.length).toBeGreaterThan(10)
})
test('/me route without identity → 401', async () => {
  const res = await appUnderTest().request('/me/x')
  expect(res.status).toBe(401)
})
test('malformed provider → 401 on /me', async () => {
  const res = await appUnderTest().request('/me/x', { headers: { 'X-BrewDial-Identity': 'bogus:short' } })
  expect(res.status).toBe(401)
})
```

- [ ] **Step 3: implement** — `apps/api/src/middleware/identity.ts`
```ts
import type { Context, Next } from 'hono'
import { getDb } from '@brewdial/db'
import { resolveAppUser } from '@brewdial/db' // re-export from packages/db index

const VALID = new Set(['toss_anon', 'web_local'])

export async function identityMiddleware(c: Context, next: Next) {
  const raw = c.req.header('X-BrewDial-Identity')
  if (raw) {
    const i = raw.indexOf(':')
    const provider = i >= 0 ? raw.slice(0, i) : ''
    const externalKey = i >= 0 ? raw.slice(i + 1) : ''
    if (VALID.has(provider) && externalKey.length >= 16) {
      try { c.set('appUserId', await resolveAppUser(getDb(), provider, externalKey)) } catch { /* leave unset */ }
    }
  }
  await next()
}

export async function requireIdentity(c: Context, next: Next) {
  if (!c.get('appUserId')) return c.json({ ok: false, error: 'identity required' }, 401)
  await next()
}
```
Add `appUserId` to Hono `ContextVariableMap` via `declare module 'hono' { interface ContextVariableMap { appUserId?: string } }` in a `apps/api/src/types.d.ts`. Re-export `resolveAppUser` from `packages/db/src/index.ts`.

- [ ] **Step 4: run** — `export DATABASE_URL='postgres://mgh3326@localhost:5432/brewdial_test'; pnpm --filter @brewdial/db build && pnpm --filter @brewdial/api test` → identity tests pass.
- [ ] **Step 5: commit** — `git add packages/db/src/repositories/identity.ts packages/db/src/index.ts apps/api/src/middleware apps/api/src/types.d.ts && git commit -m "feat(api): X-BrewDial-Identity middleware + resolveAppUser repository"`

---

### Task 2: Recipe + feedback READ endpoints

**Files:** Create `packages/db/src/repositories/recipes.ts`, `packages/db/src/repositories/feedback.ts`, `apps/api/src/routes/recipes.ts`, `apps/api/src/routes/feedback.ts`; Test `apps/api/src/routes/recipes.test.ts`.

**Interfaces:**
- Produces: `listRecentRecipes(db, limit)`, `getRecipeByCode(db, code)`, `listRecipesByBean(db, beanId)`, `listFeedbackByRecipe(db, code)` — all returning rows projecting the client mapper's column lists. Routes: `GET /api/recipes?status=active&limit=`, `GET /api/recipes?beanId=`, `GET /api/recipes/:code`, `GET /api/recipes/:code/feedback`.

- [ ] **Step 1: repositories** (project the RECIPE_COLUMNS / FEEDBACK_COLUMNS the client expects — read `apps/miniapp/src/lib/data/mappers.ts` for the exact column list; use `.select([...])` with those snake_case column names, NOT `selectAll`, so the shape is pinned). `recipes.ts`:
```ts
import { type Kysely } from 'kysely'
import type { DB } from '../types.js'
const RECIPE_COLS = [/* fill from mappers.ts RECIPE_COLUMNS, snake_case */] as const
export function listRecentRecipes(db: Kysely<DB>, limit = 20) {
  const n = Math.min(100, Math.max(1, limit))
  return db.selectFrom('recipes').select(RECIPE_COLS).where('status','=','active').orderBy('created_at','desc').limit(n).execute()
}
export function getRecipeByCode(db: Kysely<DB>, code: string) {
  return db.selectFrom('recipes').select(RECIPE_COLS).where('code','=',code).where('status','<>','test').executeTakeFirst()
}
export function listRecipesByBean(db: Kysely<DB>, beanId: string) {
  return db.selectFrom('recipes').select(RECIPE_COLS).where('bean_id','=',beanId).where('status','=','active').orderBy('created_at','desc').execute()
}
```
`feedback.ts`: `listFeedbackByRecipe(db, code)` selecting `FEEDBACK_COLUMNS` where `recipe_code=code` order `created_at desc`.

- [ ] **Step 2: failing route test** — `recipes.test.ts`: seed (unique-coded) recipes with statuses active/test/superseded and a bean; assert `GET /api/recipes` returns only active (newest first, ≤limit), `GET /api/recipes/:code` returns the row and 404 for a `test`-status code, `GET /api/recipes?beanId=` filters by bean, `GET /api/recipes/:code/feedback` returns seeded feedback. Assert response rows contain the expected snake_case keys (e.g. `created_by`, `is_official`).
- [ ] **Step 3: routes** — `routes/recipes.ts` mounts the three recipe GETs (+ `?beanId=` branch) and delegates to the repo; `routes/feedback.ts` the feedback GET. 404 when `getRecipeByCode` returns undefined.
- [ ] **Step 4: run tests → pass.**
- [ ] **Step 5: commit** — `feat(api): recipe + feedback read endpoints (parity column shape)`

---

### Task 3: Beans + registries READ endpoints

**Files:** Create `packages/db/src/repositories/beans.ts`, `apps/api/src/routes/beans.ts`, `apps/api/src/routes/registries.ts`; Test `apps/api/src/routes/beans.test.ts`.

**Interfaces:** `listBeans(db)` (from `bean_summaries`, `recipe_count>0`, order `latest_recipe_at desc`), `getBean(db,id)` (single). Routes `GET /api/beans`, `GET /api/beans/:id`, `GET /api/grinders`, `GET /api/drippers`.

- [ ] **Step 1: repo** — `beans.ts` selects the `bean_summaries` columns the client expects (`id,name,roaster,origin,process,roast_level,notes,recipe_count,latest_recipe_at,has_ai`). `listBeans`: `.where('recipe_count','>',0).orderBy('latest_recipe_at','desc')`. `getBean`: `.where('id','=',id).executeTakeFirst()`.
- [ ] **Step 2: failing test** — seed beans + active recipes so `bean_summaries` rolls up; assert `GET /api/beans` returns only beans with recipe_count>0, `GET /api/beans/:id` returns one or 404, `GET /api/grinders`/`/api/drippers` return registry rows ordered (name / continuum_position).
- [ ] **Step 3: routes** — beans.ts + registries.ts (registries use `listGrinders`/`listDrippers` from M2's `repositories/registries.ts`).
- [ ] **Step 4: run → pass.**
- [ ] **Step 5: commit** — `feat(api): beans + registries read endpoints`

---

### Task 4: Recipe + feedback WRITE endpoints

**Files:** Modify `packages/db/src/repositories/recipes.ts` (add `insertManualRecipe`), `packages/db/src/repositories/feedback.ts` (add `insertFeedback`); modify `apps/api/src/routes/recipes.ts` + `routes/feedback.ts`; Test `apps/api/src/routes/recipes.write.test.ts`.

**Interfaces:** `insertManualRecipe(db, payload)` → inserts with `created_by='manual'`, `version=1`, `status='active'`, `owner_id` unset; passes `bean_snapshot` through and leaves `bean_id` NULL when not provided (so `recipes_link_bean` trigger links). Returns the inserted row (RECIPE_COLS). `insertFeedback(db, payload)` → inserts with `source` default `'web'`. Routes `POST /api/recipes`, `POST /api/recipes/:code/feedback`.

- [ ] **Step 1: failing test** — `recipes.write.test.ts`:
  - `POST /api/recipes` with `{method,title}` (+ optional `beanSnapshot`) → 201, response row has `created_by='manual'`, `version=1`, `status='active'`, `owner_id=null`. With a `beanSnapshot` and no `beanId` → response `bean_id` is non-null (trigger linked).
  - `POST /api/recipes` with a body that includes `owner_id`/`is_official=true`/`created_by:'agent'` → those are IGNORED; result is `owner_id=null,is_official=false,created_by='manual'`.
  - `POST /api/recipes/:code/feedback` with `{rawComment}` → 201, `source='web'`.
- [ ] **Step 2: repository inserts** — `insertManualRecipe`: build an insert object from the validated payload, **hardcoding** `created_by:'manual'`, `version:1`, `status:'active'`, omitting `owner_id`/`is_official`; set `bean_snapshot` from payload, leave `bean_id` unset/null. `.returning(RECIPE_COLS).executeTakeFirstOrThrow()`. `insertFeedback`: insert with `source: payload.source ?? 'web'`, `.returning(FEEDBACK_COLS)`.
- [ ] **Step 3: routes** — POST handlers parse+validate body (reuse `@brewdial/shared` validators if present, e.g. `validateCreateRecipeInput`), strip any owner/official/created_by keys before passing to the repo, return 201.
- [ ] **Step 4: run → pass** (guard trigger enforces the owner/official invariant; the test proves the body-injection is ignored).
- [ ] **Step 5: commit** — `feat(api): manual recipe + feedback write endpoints (server-controlled ownership)`

---

### Task 5: `/api/me/*` personalization (identity-scoped)

**Files:** Create `packages/db/src/repositories/{saved,gear,collections}.ts`, `apps/api/src/services/{save,collections}.ts`, `apps/api/src/routes/me.ts`; Test `apps/api/src/routes/me.test.ts`.

**Interfaces:** Routes (all behind `requireIdentity`): `POST /api/me/saved-recipes {code}`, `POST /api/me/saved-beans {beanId}`, `GET /api/me/collections`, `PUT /api/me/gear {...}`, `PUT /api/me/calibration {...}`. All scope by `c.get('appUserId')`.

- [ ] **Step 1: failing test** — `me.test.ts` (uses a unique `X-BrewDial-Identity` per run): save a seeded recipe → `GET /api/me/collections` shows it under `savedRecipes` **with a populated `snapshot`**; save a bean → appears under `savedBeans`; `PUT /api/me/gear` a default grinder twice (different labels) → only the latest is `is_default` for that kind; `PUT /api/me/calibration` then again on the same pair → upsert (one row, updated). Collections response is the camelCase composite `{savedRecipes,savedBeans,gear,calibration,myRecipes}`.
- [ ] **Step 2: saved repo** — `saved.ts`:
```ts
import { sql, type Kysely } from 'kysely'
import type { DB } from '../types.js'
// snapshot captured server-side via to_jsonb of the recipe row (excludes test-status), upsert on (app_user_id, recipe_code)
export async function saveRecipe(db: Kysely<DB>, appUserId: string, code: string) {
  await sql`
    insert into saved_recipes (app_user_id, recipe_code, snapshot)
    select ${appUserId}::uuid, r.code, to_jsonb(r)
      from recipes r where r.code = ${code} and r.status <> 'test'
    on conflict (app_user_id, recipe_code) do update set snapshot = excluded.snapshot`.execute(db)
}
export async function saveBean(db: Kysely<DB>, appUserId: string, beanId: string) {
  await sql`insert into saved_beans (app_user_id, bean_id) values (${appUserId}::uuid, ${beanId})
            on conflict (app_user_id, bean_id) do nothing`.execute(db)
}
```
- [ ] **Step 3: gear/calibration repo** — `gear.ts` `upsertGear`: in a `db.transaction()`, if `isDefault` then `update user_gear set is_default=false where app_user_id=? and kind=? and is_default`, then insert the gear row (return id). `upsertCalibration`: upsert on the coalesce-stable pair unique index (match the index from schema 003/001 — `select … then insert/update` within a txn keyed on `coalesce(from_grinder_id::text,lower(from_label))`, `coalesce(to_grinder_id::text,lower(to_label))`, `coalesce(anchor_method,'')`).
- [ ] **Step 4: collections service** — `collections.ts` reads `saved_recipes`, `saved_beans`, `user_gear`, `grinder_calibration` for the app_user, and owned recipe codes (`recipes.owner_id = appUserId`), and assembles the **exact camelCase composite** the old `rpc_my_collections` returned (compare `apps/miniapp/src/lib/data/user-content.ts` for the field names/shape).
- [ ] **Step 5: routes** — `me.ts` mounts the 5 routes behind `requireIdentity`, each using `c.get('appUserId')`.
- [ ] **Step 6: run → pass.**
- [ ] **Step 7: commit** — `feat(api): /api/me personalization (save, collections, gear, calibration) identity-scoped`

---

### Task 6: Wire routers + shape-parity check + housekeeping

**Files:** Modify `apps/api/src/app.ts`; Test `apps/api/src/routes/shape.test.ts`.

- [ ] **Step 1: mount** — `app.ts`: `app.use('/api/*', identityMiddleware)` then `app.route('/api', recipes)`, `beans`, `registries`, `feedback`, `me` (and existing `health`). Ensure `/api/me/*` routers apply `requireIdentity`.
- [ ] **Step 2: failing shape test** — `shape.test.ts`: seed one active recipe + one feedback; assert `GET /api/recipes` row keys are a **superset of** the client `RECIPE_COLUMNS` set (read the list from `apps/miniapp/src/lib/data/mappers.ts`) and feedback row keys ⊇ `FEEDBACK_COLUMNS`; assert `GET /api/me/collections` top-level keys === `['savedRecipes','savedBeans','gear','calibration','myRecipes']`.
- [ ] **Step 3: run full suite** — `pnpm --filter @brewdial/db test && pnpm --filter @brewdial/api test` → all green; `tsc` clean both workspaces.
- [ ] **Step 4: commit** — `feat(api): mount client routers + response-shape parity test`

---

## Self-Review notes
- M3 = client surface only. Agent/admin endpoints (`/api/agent/*`, find_bean search, status transitions, supersede, any-status reads, context aggregators) are **M4** (ROB-622). Client-data-layer swap + CF proxy = M5. Data import/cutover = M6.
- Live-Supabase golden fixtures are an M6 cutover-validation step; M3's parity is verified against locally-seeded data + the documented column shapes.
- All personalization logic is TS services (Spec 1 §4.4); the only SQL "logic" is the `to_jsonb` snapshot capture inside one insert and the gear default-clearing inside a transaction — no new stored functions.
- Owner/official invariant is enforced by the surviving `bd_guard_recipe_owner_immutable` trigger; Task 4 proves body-injected owner/official is ignored.
