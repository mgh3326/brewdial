# M5 — Client Swap (Supabase → backend API) + MCP repoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> **⚠️ DEPLOY HELD:** build + test only. Do NOT run `wrangler deploy`, resubmit the `.ait`, or migrate/flip production. The actual cutover is M6 (explicit go). Backend (CORS) MAY be redeployed to the OCI box (additive, safe).

**Goal:** Repoint the mini-app/web client and the MCP server off `@supabase/supabase-js`/PostgREST onto the live OCI backend (`https://api.brewdial.robinco.dev`), preserving v1 behavior, with the swap merged-but-not-deployed until M6.

**Architecture decision (supersedes Spec 1's CF-Worker-proxy):** the backend already sits behind the Cloudflare Tunnel (`api.brewdial.robinco.dev` is a CF-proxied hostname), so the origin is already hidden. Clients call that URL **directly** with permissive **CORS** on the backend (header-auth, no cookies → `Access-Control-Allow-Origin: *` is safe). No CF Worker reverse-proxy needed; `wrangler.jsonc` stays static-asset hosting.

**Tech Stack:** existing — miniapp React/Vite (`apps/miniapp`), MCP Node (`apps/mcp`), backend Hono (`apps/api`, live). Vitest, local Postgres for backend tests; client tests mock `fetch`.

## Global Constraints
- **Behavior parity:** every current read/write keeps the same user-facing behavior; the data modules keep using `mappers.ts` (rows → docs) — only the fetch mechanism changes (supabase → HTTP).
- **Identity:** client sends `X-BrewDial-Identity: <provider>:<externalKey>` (from `resolveIdentity()`) on personalization/write calls. Reads need no identity.
- **API base:** `VITE_API_BASE_URL` (build-time for web; **runtime-configurable for the `.ait`** so future moves need no resubmit). Default/prod = `https://api.brewdial.robinco.dev`.
- **MCP:** uses the agent surface `https://api.brewdial.robinco.dev/api/agent/*` with `Authorization: Bearer <AGENT_TOKEN>`; the service_role/Supabase env is removed. Context-summary assembly (`apps/mcp/src/context.ts`) stays, consuming the new data endpoints.
- **No Supabase remnants** in client/MCP after M5: `@supabase/supabase-js` removed from `apps/miniapp`; MCP's PostgREST/service_role client replaced.
- tsc-clean for `apps/miniapp` + `apps/mcp` + `apps/api`. DEPLOY HELD (see banner).

---

### Task 1: Backend CORS + redeploy
**Files:** `apps/api/src/app.ts` (add Hono `cors`), `apps/api/src/cors.test.ts`.
- [ ] Add Hono `cors()` middleware on `/api/*` (before routers): `origin: '*'`, `allowMethods: GET,POST,PUT,PATCH,DELETE,OPTIONS`, `allowHeaders: Content-Type, Authorization, X-BrewDial-Identity`, `maxAge`. (Header-auth, no cookies → `*` is safe; servers/MCP ignore CORS.)
- [ ] Test: an `OPTIONS /api/recipes` preflight with `Origin: https://coffee.robinco.dev` + `Access-Control-Request-Headers: x-brewdial-identity` returns 204/200 with the allow headers; a `GET /api/health` carries `Access-Control-Allow-Origin: *`.
- [ ] Verify (`pnpm --filter @brewdial/api build && test`), then **redeploy backend to the OCI box** (rsync apps/api + `pnpm --filter @brewdial/api build` + `sudo systemctl restart brewdial-api`) and confirm a cross-origin preflight succeeds against `https://api.brewdial.robinco.dev`.
- [ ] Commit `feat(api): permissive CORS for browser/.ait clients`.

### Task 2: mini-app HTTP API client
**Files:** Create `apps/miniapp/src/lib/api.ts`; Test `apps/miniapp/src/lib/api.test.ts`.
- [ ] `api.ts`: a `fetch` wrapper. Base = `import.meta.env.VITE_API_BASE_URL` (web) **or a runtime override** (see Task 5 for `.ait`). Helpers `apiGet(path)`, `apiSend(method, path, body, { identity })`. Inject `X-BrewDial-Identity: <provider>:<externalKey>` when an identity is passed. Parse JSON; on non-2xx throw an error compatible with the existing `dbError()` handling in `src/lib/labels.ts` (preserve the user-facing error mapping). 401 on `/me` → surface a typed "needs login"/identity error.
- [ ] Test (mock `fetch`): GET hits `${base}${path}`; identity header set when provided; non-2xx throws; JSON parsed.
- [ ] Commit `feat(miniapp): HTTP API client (api.ts) with identity header`.

### Task 3: Repoint READ data modules
**Files:** `apps/miniapp/src/lib/data/{recipes,beans,grinders,drippers,feedback,preferences}.ts`; Tests alongside (mock `fetch`/`api`).
- [ ] Replace each `supabase.from(...).select(...)` with the matching API call, KEEPING the `mappers.ts` row→doc mapping:
  - recipes: `listRecentRecipes`→`GET /api/recipes?limit=`, `getRecipeByCode`→`GET /api/recipes/:code`, `listRecipesByBean`→`GET /api/recipes?beanId=`.
  - beans: `listBeans`→`GET /api/beans`, `getBean`→`GET /api/beans/:id`.
  - grinders/drippers: `GET /api/grinders` / `GET /api/drippers`.
  - feedback: `listFeedbackByRecipe`→`GET /api/recipes/:code/feedback`.
  - preferences (if still used): `GET /api/preferences/global` — NOTE this endpoint is M4 agent-gated; if the client needs it, either expose a public read or drop the (currently unused) wrapper. Confirm no caller; if none, delete the wrapper.
- [ ] Tests verify each module calls the right path + maps rows correctly (mock the api layer).
- [ ] Commit `feat(miniapp): repoint read data modules to backend API`.

### Task 4: Repoint WRITE + personalization modules
**Files:** `apps/miniapp/src/lib/data/{recipes,feedback,user-content,gear}.ts`; Tests.
- [ ] recipes `createRecipe`→`POST /api/recipes`; feedback `createFeedback`→`POST /api/recipes/:code/feedback`.
- [ ] user-content (identity-scoped, send identity header): `saveRecipe`→`POST /api/me/saved-recipes`, `saveBean`→`POST /api/me/saved-beans`, `getMyCollections`→`GET /api/me/collections`, `upsertGear`→`PUT /api/me/gear`, `upsertCalibration`→`PUT /api/me/calibration`. (`createOwnedRecipe` was unused/M3-dropped — confirm + drop.)
- [ ] Keep the composite `{savedRecipes,...}` consumption identical (the API returns the same shape).
- [ ] Tests verify paths + identity header + body shapes (mock api).
- [ ] Commit `feat(miniapp): repoint write + /me personalization to backend API`.

### Task 5: Remove Supabase + env/build wiring + .ait runtime config
**Files:** delete `apps/miniapp/src/lib/supabase.ts`; `apps/miniapp/package.json` (drop `@supabase/supabase-js`); `apps/miniapp/vite.config.ts` (build guard); `apps/miniapp/src/vite-env.d.ts`; `.env.example`; a small runtime-config for `.ait`.
- [ ] Delete `supabase.ts` + remove `@supabase/supabase-js` dependency. Confirm no remaining imports.
- [ ] env: replace `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` with `VITE_API_BASE_URL`; update the `vite.config.ts` production build guard to require `VITE_API_BASE_URL`; update `src/vite-env.d.ts` types + `.env.example`.
- [ ] **`.ait` runtime config:** so the Toss build isn't pinned to a build-time URL, resolve the API base at runtime (e.g. read a small `/config.json` served with the bundle, or a Toss-provided config) with `VITE_API_BASE_URL` as the fallback default. Implement minimally; document it.
- [ ] Verify: `pnpm --filter @brewdial/miniapp build` (`.ait`) AND `pnpm --filter @brewdial/miniapp web:build` (web) both succeed with `VITE_API_BASE_URL=https://api.brewdial.robinco.dev`; `tsc` clean; no Supabase references remain (`grep -ri supabase apps/miniapp/src` → none).
- [ ] Commit `feat(miniapp): remove Supabase; VITE_API_BASE_URL + .ait runtime API base`.

### Task 6: MCP repoint to the agent API
**Files:** `apps/mcp/src/supabase.ts` → replace with an API client; `apps/mcp/src/config.ts`; `apps/mcp/src/repositories/*`; Tests.
- [ ] Replace the PostgREST/service_role fetch client with an HTTP client to `${API_BASE}/api/agent/*` + `Authorization: Bearer ${AGENT_TOKEN}`. config: `API_BASE_URL` + `AGENT_TOKEN` env (drop `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).
- [ ] Repoint the repositories to the M4 agent endpoints: create→`POST /api/agent/recipes`, update→`PATCH /api/agent/recipes/:code`, status→`PATCH .../:code/status`, supersede→`POST /api/agent/recipes/supersede`, find_bean→`GET /api/beans?q=`, list_beans→`GET /api/beans`, grinders/drippers→`GET /api/{grinders,drippers}`, any-status read→`GET /api/agent/recipes/:code`, feedback→`POST /api/agent/feedback`, prefs→`GET /api/agent/preferences/global`. `context.ts` keeps building summaries from these.
- [ ] Map the agent endpoints' row responses via `mappers.ts` (unify with `packages/db` if trivial; else keep MCP mapper). The prefs endpoint returns the raw row → MCP's existing camelCase mapping applies.
- [ ] Tests: mock the HTTP client; OR an integration smoke against the live backend with the real AGENT_TOKEN (create→read an agent recipe). Drop the old `supabase.test.ts` expectations.
- [ ] Commit `feat(mcp): repoint to backend agent API (drop Supabase service_role)`.

---

## Self-Review notes
- DEPLOY HELD: M5 is merged-but-not-deployed. The live SPA/`.ait`/MCP keep using Supabase until M6 cutover (manual `wrangler deploy` + `.ait` resubmit + MCP env switch happen in M6 after data migration).
- Architecture change from Spec 1: CORS-direct instead of CF Worker proxy (tunnel already hides origin). `wrangler.jsonc` unchanged (static hosting).
- M6 (next): write-freeze Supabase → `pg_dump`→OCI import + `recipe_code_seq` setval → flip clients (deploy) → bake → decommission. Needs Supabase access + explicit go.
- Backend CORS (Task 1) is safe to redeploy to the box now (additive); it does not constitute the client cutover.
