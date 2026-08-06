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

## k3s runtime (production since 2026-08-06 — ROB-1214)

Public API traffic is served by **k3s variant B** (pod network + NodePort
30020). Manifests + full runbook: `k3s/` (`k3s/RUNBOOK.md`). Image builds:
`.github/workflows/image.yml`. Always deploy by digest, never `:latest`.

**Confirmed at cutover (see RUNBOOK §0 for the full precondition list):**
cloudflared ingress → `http://127.0.0.1:30020`; host Postgres also listens on
bridge IP `10.42.0.1` with pod-CIDR `pg_hba`; systemd `brewdial-api` is still
left running on `:3020` as a reversible fallback (not stopped — observation
period is an operator decision).

## systemd path (fallback / recovery — not the public path)

The systemd unit below remains installed and was **not** disabled at cutover.
Use it for emergency traffic rollback (re-point cloudflared to `:3020`) or
manual rebuilds. It is **not** the Phase 2 k3s deployment path.

```bash
# from a local checkout of main:
rsync -az --exclude .git --exclude node_modules --exclude dist --exclude .superpowers \
  -e "ssh -i <key>" ./ opc@<host>:/opt/brewdial/
ssh -i <key> opc@<host> 'cd /opt/brewdial && pnpm install && \
  pnpm --filter @brewdial/shared --filter @brewdial/db --filter @brewdial/api build && \
  sudo systemctl restart brewdial-api && curl -s localhost:3020/api/health'
# schema changes:
ssh -i <key> opc@<host> 'cd /opt/brewdial/packages/db && \
  DATABASE_URL=$(grep ^DATABASE_URL /etc/brewdial/api.env|cut -d= -f2-) pnpm exec node-pg-migrate -m migrations -j sql up'
```

## Remaining (needs operator action)
1. **Cloudflare Tunnel** (interactive — your CF account + domain): `cloudflared tunnel login` → `cloudflared tunnel create brewdial` → write `~/.cloudflared/config.yml` (see `cloudflared-config.example.yml`) → `cloudflared tunnel route dns brewdial api.brewdial.<domain>` → `sudo cloudflared service install && sudo systemctl enable --now cloudflared`.
2. **Backups (ROB-630):** implemented as `backup.sh` + `brewdial-backup.{service,timer}`
   (`pg_dump -Fc` + globals, retention 7 daily / 4 weekly) → box-local `/var/backups/brewdial`,
   pulled off-box to a Mac (`deploy/mac/`), with a **verified-restore gate** `verify-restore.sh`
   + `brewdial-verify.timer` (the gate before decommissioning Supabase). Off-box target is the
   Mac (not OCI Object Storage) to stay within the free tier. Full procedure + DR steps:
   `docs/superpowers/plans/2026-06-29-rob-630-backup-restore-runbook.md`.
3. **k3s Phase 2 design:** the manifest placement, release identity, audit
   trail, rollback procedure, and non-interactive `KUBECONFIG` requirement
   are specified in `k3s/RUNBOOK.md` under “Phase 2 design”. The CI workflow
   and box checkout are not implemented until that design receives its own
   approval.
