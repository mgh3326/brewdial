# k3s deploy runbook — BrewDial API (ROB-1214)

Single-node k3s on the OCI box (Oracle Linux 9.7, aarch64, SELinux Enforcing).
Postgres stays on the **host**, outside the cluster (hard invariant — the
ROB-630 backup + weekly verify-restore gate targets host PG).

Phase 1 scope: everything here is validated in CI (`.github/workflows/k8s-validate.yml`).
**First production cutover is a separate approval, executed by the operator.**

## 0. Decision record — network variant (A) vs (B)

The one real design fork: how pods reach host Postgres and how cloudflared
reaches the API.

| | **(A) hostNetwork** (`deployment.yaml`) | **(B) pod network** (`variant-b/`) |
|---|---|---|
| `DATABASE_URL` | unchanged (`127.0.0.1:5432`) | must target the **CNI bridge IP** |
| cloudflared | unchanged (`http://127.0.0.1:3020`) | re-point to NodePort `http://127.0.0.1:30020` |
| host Postgres config | **no change** | `listen_addresses` += bridge IP, `pg_hba` limited to pod CIDR — **production DB change, operator + separate approval** |
| rolling updates | `maxSurge=0` forced (two pods can't share :3020) → **downtime window on every rollout** (old pod stops, new pod starts: typically seconds) | `maxSurge=1, maxUnavailable=0` → **zero-downtime** |
| moving parts | fewest | Service (NodePort) + DB reconfig + cloudflared re-target |

**Default in this repo is (A)** — not because it is better, but because it is
the only variant that can go live without an unapproved production change.
Upstream recommends (B) (zero-downtime rolling was a reason for adopting k3s);
switching later is cheap:

```bash
kubectl -n brewdial delete deploy brewdial-api
# 1. operator: PG listen_addresses += <cni0/bridge IP>, pg_hba += pod CIDR (scram)
# 2. edit Secret: DATABASE_URL → postgres://brewdial_app:<pw>@<bridge-ip>:5432/brewdial
kubectl apply -f deploy/oci/k3s/variant-b/
# 3. cloudflared: service http://127.0.0.1:30020  (was :3020)
```

The bridge IP / pod CIDR are only knowable after k3s is installed
(`ip addr show cni0`, `kubectl get node -o jsonpath='{.spec.podCIDR}'`).

## 1. Operator: install k3s (one-time)

```bash
# SELinux is Enforcing — if install/start fails, suspect k3s-selinux FIRST.
curl -sfL https://get.k3s.io | sh -s - server \
  --disable=traefik --disable=servicelb --write-kubeconfig-mode=600
```

- Traefik/ServiceLB are disabled deliberately: ingress arrives via the
  cloudflared outbound tunnel and firewalld has zero open ports — nothing may
  bind 80/443. (k3s docs: Traefik's LoadBalancer Service uses ports 80/443.)
- Hard invariants: **no new firewalld openings**, **k3s API (6443) never
  exposed to the internet**.
- CI reaches the cluster ONLY via `kubectl` on the box over
  CF Tunnel + Access SSH. **Never put kubeconfig in GitHub secrets.**

## 2. Operator: first-time cluster setup

```bash
kubectl apply -f deploy/oci/k3s/namespace.yaml
kubectl apply -f deploy/oci/k3s/configmap.yaml
# real secret — values from /etc/brewdial/api.env (never committed):
kubectl -n brewdial create secret generic brewdial-api-secret \
  --from-literal=DATABASE_URL='postgres://brewdial_app:<pw>@127.0.0.1:5432/brewdial' \
  --from-literal=AGENT_TOKEN='<openssl rand -hex 32>'
```

GHCR pull: if the package is public (repo is being flipped public), no pull
secret is needed. Otherwise: `kubectl -n brewdial create secret docker-registry
ghcr --docker-server=ghcr.io ...` + `imagePullSecrets` on the Deployment.

## 3. Deploy / update (CI does this; shown here for manual use)

Images carry two tags: immutable `:sha-<short>` and moving `:latest`.
**Always deploy by digest.**

```bash
DIGEST=$(crane digest ghcr.io/mgh3326/brewdial:sha-<short>)   # or from the image.yml run log
kubectl -n brewdial set image deploy/brewdial-api \
  api=ghcr.io/mgh3326/brewdial@sha256:<digest> migrate=ghcr.io/mgh3326/brewdial@sha256:<digest>
kubectl -n brewdial patch configmap brewdial-api-config --type merge \
  -p '{"data":{"GIT_SHA":"<short>"}}'
kubectl -n brewdial rollout status deploy/brewdial-api
curl -fs localhost:3020/api/db/health
```

Migrations run in the pod's **initContainer** before the app starts — so a
deploy that includes migrations applies them automatically, and a failing
migration blocks the app from starting (rollout fails → see §4).

## 4. Rollback

```bash
kubectl -n brewdial rollout history deploy/brewdial-api
kubectl -n brewdial rollout undo deploy/brewdial-api        # or: --to-revision=N
kubectl -n brewdial rollout status deploy/brewdial-api
```

This exact path (broken image → failed rollout → `rollout undo` → healthy) is
exercised in CI on every PR — see the `k8s-validate.yml` run log.

🔴 **Rollback does NOT undo migrations.** `rollout undo` restores the previous
pod spec; the database schema stays wherever the newer migration left it.
Therefore, once auto-migration is in the deploy path, **every migration must
follow expand/contract**: expand (add columns/tables, backfill, keep old code
working) in release N, contract (drop/renames) only in release N+1 after all
pods run N. Never ship a destructive migration in the same release as the code
that stops using the old shape — a rollback would then run old code against a
schema it can't handle.

## 5. Cutover (separate approval) — downtime map

Variant (A) cutover from systemd to k3s:

1. Deploy the k3s manifests (pod comes up on hostNetwork :3020 **after** the
   systemd unit releases the port — see next step ordering).
2. 🔴 **Downtime point**: `sudo systemctl stop brewdial-api` → new pod binds
   :3020 and passes readiness. This window (seconds) is unavoidable with
   hostNetwork. **No cloudflared change is needed for variant (A)** — the
   tunnel keeps hitting `127.0.0.1:3020`.
3. If/when moving to variant (B) later: 🔴 **second downtime point** is the
   cloudflared re-target (`:3020` → NodePort `:30020`); the tunnel picks up the
   new config only after `cloudflared` reload/restart.

## 6. Recovery bypass — k3s is down, serve via podman

If k3s itself is broken, run the **same image** directly (podman 5.x is
already on the box):

```bash
# 1. apply any pending migrations first (idempotent, same image):
sudo podman run --rm --network host --env-file /etc/brewdial/api.env \
  ghcr.io/mgh3326/brewdial@sha256:<digest> \
  node /migrate/node_modules/node-pg-migrate/bin/node-pg-migrate.js \
    -m /migrate/migrations -j sql up

# 2. serve (hostNetwork → 127.0.0.1:3020, cloudflared path unchanged):
sudo podman run -d --name brewdial-api-rescue --restart=always \
  --network host --env-file /etc/brewdial/api.env \
  ghcr.io/mgh3326/brewdial@sha256:<digest>

curl -fs localhost:3020/api/db/health
# when k3s is healthy again: sudo podman rm -f brewdial-api-rescue
```

(`--network host` mirrors variant (A): `127.0.0.1:5432` DSN and the
cloudflared→3020 path both keep working. SELinux Enforcing is fine here —
no volumes are mounted.)

## 7. CI deployment (Phase 2 — NOT in this merge)

`.github/workflows/deploy-oci.yml` (CF Tunnel + Access Service Auth → SSH →
box-local `kubectl apply`) is **deliberately absent** from Phase 1: the CF
Tunnel SSH route, Access app, Service Auth policy, service token and GitHub
secrets are all operator-unset, so such a workflow cannot be verified end to
end today. It lands only after the operator completes the Linear checklist and
the workflow has been proven on a real run.
