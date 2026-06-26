# M6 — Data migration + cutover runbook (ROB-624)

Supabase → OCI cutover. Backend (M2-M4) live; client/MCP swap built (PR #38, deploy-held).

## Data migration — loader
`packages/db/scripts/migrate-from-supabase.mjs` pulls every table from Supabase (PostgREST, service_role) and full-replaces OCI Postgres. Idempotent (TRUNCATE + load). Runs as `brewdial_app` (table owner) — no superuser:
- recipes' user triggers (bean-link + owner guard) disabled around the recipes load → `owner_id`/`is_official`/`created_by`/`bean_id` import **verbatim**; FK integrity via load order; `recipe_code_seq` set from `MAX(code)`.
- Run on the box: `cd /opt/brewdial/packages/db && DATABASE_URL=<brewdial_app> SUPABASE_URL=<...> SUPABASE_SERVICE_ROLE_KEY=<...> node scripts/migrate-from-supabase.mjs`

**Rehearsal (2026-06-26): SUCCESS** — all 14 tables match (recipes 61, beans 17, feedback 15, grinders 9, drippers 5, app_users 6, user_identities 6, user_gear 1, grinder_calibration 1, saved 2+2, prefs 1, bd_migration_meta 1; bean_photos/links 0). `recipe_code_seq`=61. Verified: `created_by='agent'`, `is_official` (59 true), `bean_id` (58), jsonb all preserved; live API serves the data. (OCI now holds a rehearsal copy; the cutover re-runs the loader for the latest state.)

## Cutover sequence (gated — irreversible at decommission)

Traffic is ~nil (personal app), so the gap risk is small; still, freeze to be safe.

1. **(operator) Write-freeze Supabase** — Supabase SQL editor: `revoke insert, update, delete on all tables in schema public from anon, authenticated, service_role;` (reversible — re-grant to roll back). Stops any in-flight write (incl. old `.ait` clients) so nothing is lost after the final dump. Reads still work.
2. **(me) Final loader re-run** → OCI now == Supabase's frozen state. Re-verify counts.
3. **(me/operator) Web flip** — `pnpm web:build` with `VITE_API_BASE_URL=https://api.brewdial.robinco.dev` → `wrangler deploy` (needs CF auth). **Merge PR #38.** coffee.robinco.dev now uses OCI.
4. **(operator) `.ait` resubmit** — rebuild the `.ait` (with `VITE_API_BASE_URL` / runtime base) + **resubmit through the Toss console** (⚠️ review + propagation lead time — the long pole). Until adopted, old `.ait` hits the frozen Supabase (reads OK, writes fail gracefully).
5. **(operator) MCP env switch** — operator `.mcp.json`: set `API_BASE_URL=https://api.brewdial.robinco.dev` + `AGENT_TOKEN=<from /etc/brewdial/api.env>`, drop `SUPABASE_*`; rebuild MCP.
6. **Bake** — keep Supabase read-only for the bake period (until `.ait` adoption + OCI backup confidence). Then **decommission** (irreversible).

## Rollback
- Web: redeploy the previous CF Worker revision (points back at Supabase) + re-grant Supabase writes.
- `.ait`: already pinned to whatever was submitted; runtime API-base hook can redirect if used.
- Keep Supabase fully intact (not just read-only) until the bake completes.

## Notes
- Backups: operator opted to skip OCI backups at this stage; revisit before decommissioning Supabase (Supabase is the de-facto backup until then).
- v2 Toss auth (Spec 2) is a separate follow-on on this backend.
