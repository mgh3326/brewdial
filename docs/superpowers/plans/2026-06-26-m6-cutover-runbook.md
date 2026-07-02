# M6 — Data migration + cutover runbook (ROB-624)

Supabase → OCI cutover. Backend (M2-M4) live; client/MCP swap built (PR #38, deploy-held).

## Data migration — loader
`packages/db/scripts/migrate-from-supabase.mjs` pulls every table from Supabase (PostgREST, service_role) and full-replaces OCI Postgres. Idempotent (TRUNCATE + load). Runs as `brewdial_app` (table owner) — no superuser:
- recipes' user triggers (bean-link + owner guard) disabled around the recipes load → `owner_id`/`is_official`/`created_by`/`bean_id` import **verbatim**; FK integrity via load order; `recipe_code_seq` set from `MAX(code)`.
- Run on the box: `cd /opt/brewdial/packages/db && DATABASE_URL=<brewdial_app> SUPABASE_URL=<...> SUPABASE_SERVICE_ROLE_KEY=<...> node scripts/migrate-from-supabase.mjs`

**Rehearsal (2026-06-26): SUCCESS** — all 14 tables match (recipes 61, beans 17, feedback 15, grinders 9, drippers 5, app_users 6, user_identities 6, user_gear 1, grinder_calibration 1, saved 2+2, prefs 1, bd_migration_meta 1; bean_photos/links 0). `recipe_code_seq`=61. Verified: `created_by='agent'`, `is_official` (59 true), `bean_id` (58), jsonb all preserved; live API serves the data. (OCI now holds a rehearsal copy; the cutover re-runs the loader for the latest state.)

## Cutover sequence (gated — irreversible at decommission)

Traffic is ~nil (personal app), so the gap risk is small. Operator confirmed Supabase was not being written during cutover, so the formal write-freeze (step 1) was skipped.

1. ~~Write-freeze Supabase~~ — **SKIPPED** (operator confirmed no active writes 2026-06-29). If needed later: Supabase SQL editor `revoke insert, update, delete on all tables in schema public from anon, authenticated, service_role;` (reversible).
2. **Final loader re-run** — ✅ **DONE (2026-06-29)** — loader run against OCI; 14/14 tables match (`recipe_code_seq`=61); attribution + jsonb verified.
3. **Web flip** — ✅ **DONE (2026-06-29)** — CF Workers Builds env set (`VITE_API_BASE_URL=https://api.brewdial.robinco.dev`, build cmd `web:build`); **PR #38 merged** (main `9e5332c`); CF production build succeeded + deployed. coffee.robinco.dev now uses OCI.
4. **MCP env switch** — ✅ **DONE (2026-06-29)** — `~/work/brewdial` pulled to main `9e5332c`, MCP rebuilt; `~/work/brewdial/.env` given `API_BASE_URL` + `AGENT_TOKEN` (the `.mcp.json` sources that `.env`). Smoke-tested: MCP boots, `brew.get_recent_context` returns OCI data (COF codes). Token verified (agent read 200 w/ token, 401 w/o).
5. **`.ait` resubmit** — ⬜ **OPERATOR (Toss console).** Built `apps/miniapp/brewdial.ait` (OCI baked), deploymentId `019f106d-6cd2-79ed-acd0-f736e4022e76`. Operator submits/releases via the Toss/apps-in-toss console (⚠️ review lead time — the long pole). Until adopted, old `.ait` hits Supabase (reads OK; writes fail gracefully).
6. **Bake → decommission** — ⬜ keep Supabase live (read fallback) until `.ait` adoption + OCI backup confidence, then **decommission** (irreversible).

## Rollback
- Web: redeploy the previous CF Worker revision (points back at Supabase) + re-grant Supabase writes.
- `.ait`: already pinned to whatever was submitted; runtime API-base hook can redirect if used.
- Keep Supabase fully intact (not just read-only) until the bake completes.

## Notes
- Backups: operator opted to skip OCI backups at this stage; revisit before decommissioning Supabase (Supabase is the de-facto backup until then).
- v2 Toss auth (Spec 2) is a separate follow-on on this backend.
