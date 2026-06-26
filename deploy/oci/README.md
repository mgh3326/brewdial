# OCI deploy (M1) — BrewDial backend

Self-hosted backend host for the Supabase→OCI migration (epic ROB-618 / M1 ROB-619).
Full runbook: `docs/superpowers/plans/2026-06-23-m1-oci-provisioning-runbook.md`.

## Live host (2026-06-26)
- **Oracle Linux 9.7, aarch64**, 2 vCPU / 10 GB. SSH: `opc@<host>`.
- **PostgreSQL 17** (`postgresql-17.service`, enabled). DB `brewdial`, role `brewdial_app` (owner), `pgcrypto`. Bound to `127.0.0.1` only; `pg_hba` uses `scram-sha-256` for localhost.
- **Node 24 (LTS) + pnpm 10.33.2.**
- Repo at `/opt/brewdial`; backend chain (`@brewdial/shared` → `@brewdial/db` → `@brewdial/api`) built to `dist`. Migrations 001/002/003 applied (16 tables, `resolve_app_user`).
- **`brewdial-api.service`** (this dir) running, env from `/etc/brewdial/api.env` (600). Binds `127.0.0.1:3020`. `GET /api/health` + `/api/db/health` green.
- **firewalld:** only `ssh` open (3020/5432 NOT exposed). `cloudflared` installed.

## Deploy / update (until a git-based deploy is set up)
```bash
# from a local checkout of main:
rsync -az --exclude .git --exclude node_modules --exclude dist --exclude .superpowers \
  -e "ssh -i <key>" ./ opc@<host>:/opt/brewdial/
ssh opc@<host> 'cd /opt/brewdial && pnpm install && \
  pnpm --filter @brewdial/shared --filter @brewdial/db --filter @brewdial/api build && \
  sudo systemctl restart brewdial-api && curl -s localhost:3020/api/health'
# schema changes:
ssh opc@<host> 'cd /opt/brewdial/packages/db && \
  DATABASE_URL=$(grep ^DATABASE_URL /etc/brewdial/api.env|cut -d= -f2-) pnpm exec node-pg-migrate -m migrations -j sql up'
```

## Remaining (needs operator action)
1. **Cloudflare Tunnel** (interactive — your CF account + domain): `cloudflared tunnel login` → `cloudflared tunnel create brewdial` → write `~/.cloudflared/config.yml` (see `cloudflared-config.example.yml`) → `cloudflared tunnel route dns brewdial api.brewdial.<domain>` → `sudo cloudflared service install && sudo systemctl enable --now cloudflared`.
2. **Backups:** `pg_dump -Fc brewdial` cron → OCI Object Storage (needs OCI creds) + a **verified test restore** (this is the gate before decommissioning Supabase in M6).
3. (Optional) Git-based deploy: add a GitHub **deploy key** on the box for `git pull` instead of rsync.
