# k3s deploy runbook — BrewDial API (ROB-1214)

Single-node k3s on the OCI box (Oracle Linux 9.7, aarch64, SELinux Enforcing).
Postgres stays on the **host**, outside the cluster (hard invariant — the
ROB-630 backup + weekly verify-restore gate targets host PG).

Phase 1 scope: everything here is validated in CI (`.github/workflows/k8s-validate.yml`).
**Production cutover to variant B was completed 2026-08-06** (operator-approved).
This document records the applied shape. **CI image deploy** is
`.github/workflows/deploy-oci.yml` (production push + workflow_dispatch) —
see §7.

> **Fact accuracy.** Values under **Confirmed** came from a single production
> session (cutover day). Do not invent additional production IPs, digests, or
> ports. Gaps → ask the operator (`NEEDS_INFO`); a wrong public value is worse
> than an empty one. **Recommendation / procedure** text is labelled separately.

## 0. Decision record — network variant: **B selected and applied**

### Status (confirmed)

| Field | Value |
|---|---|
| Selected variant | **(B) pod network + NodePort 30020** |
| Decision date | 2026-08-06 (operator approval) |
| Production application | **complete** (2026-08-06) |
| Repo default path | `deploy/oci/k3s/deployment.yaml` + `service.yaml` |
| Legacy shape (preserved) | `deploy/oci/k3s/variant-a/` — hostNetwork; used by §6 recovery and CI |

Earlier Phase 1 text kept (A) as the repo default because it was the only
shape that needed **no** production Postgres/cloudflared change. That approval
and change **have now been applied**, so the repo default matches live
production (B). Variant (A) is **not deleted** — §6 recovery bypass
(`podman --network host`) shares A's premises.

### Comparison (design)

| | **(B) pod network — DEFAULT** (`deployment.yaml` + `service.yaml`) | **(A) hostNetwork** (`variant-a/`) |
|---|---|---|
| `DATABASE_URL` | targets the **CNI bridge IP** (not loopback) | `127.0.0.1:5432` |
| cloudflared | `http://127.0.0.1:30020` (NodePort) | `http://127.0.0.1:3020` |
| host Postgres config | `listen_addresses` includes bridge IP; `pg_hba` allows pod CIDR | loopback-only sufficient |
| rolling updates | `maxSurge=1, maxUnavailable=0` → **zero-downtime** | `maxSurge=0` → downtime window every rollout |
| coexistence with systemd on :3020 | **possible** (different ports) — used as fallback | **impossible** (both need :3020) |

### Confirmed production preconditions (applied 2026-08-06)

These are **not** optional first-cutover steps anymore — they are the live
baseline. Re-documenting them so the next operator does not guess.

**1. firewalld rich rule (pod → host Postgres)**

```text
rule family="ipv4" source address="10.42.0.0/24" port port="5432" protocol="tcp" accept
```

Notes (confirmed): `--list-ports` remains empty (no blanket open ports).
External connectivity to 5432, 30020, and 6443 is unavailable (verified at
cutover). The rich rule is the only intentional path for pod CIDR → host PG.

**2. Postgres listen + `pg_hba`**

- `ALTER SYSTEM SET listen_addresses = 'localhost,10.42.0.1'` then restart.
- Live sockets after restart (confirmed): `127.0.0.1:5432`, `10.42.0.1:5432`,
  `[::1]:5432`.
- Appended to `pg_hba.conf`:
  `host  brewdial  brewdial_app  10.42.0.0/24  scram-sha-256`
- Config backups on the box: `*.bak-20260806-0447`.
- Restart had **0** active connections → no live traffic impact observed.

**3. k8s manifests (variant B)**

- Applied: Deployment + Service (NodePort **30020**).
- Cutover-day pod IP (confirmed snapshot): `10.42.0.7` (pod IPs change on
  reschedule — do not hardcode for ops beyond that snapshot).
- Restarts at cutover validation: **0**.
- Migration initContainer log: `No migrations to run!` (001–006 already
  applied; idempotent re-run).

**4. cloudflared (local-file managed tunnel)**

- Config file: `/etc/cloudflared/config.yml`
- Ingress service changed: `http://127.0.0.1:3020` → `http://127.0.0.1:30020`
- **Local file management** — no Cloudflare dashboard change required.
- Backup: `.bak-*` beside the config on the box.

**5. Deployed image (cutover)**

```text
ghcr.io/mgh3326/brewdial@sha256:b9d4d5d947dbd56fb69adc7640bb162eac59f367164ce88ce2671a6923fa3ad1
```

Equals tag `sha-4a13cbd` (main HEAD at cutover). **`:latest` was not used.**
Subsequent deploys must continue to pin digests (see §3).

**6. systemd fallback kept running**

- Unit `brewdial-api` was **not** stopped.
- Still serves `:3020` with HTTP 200.
- Emergency rollback: re-point cloudflared ingress to
  `http://127.0.0.1:3020` only — no need to recreate the unit.
- Variant B's separate NodePort is what allows both stacks to coexist;
  that advantage was demonstrated live.

**Also confirmed (not a deploy precondition, operational note):** the live
pod received a `SENTRY_DSN`, re-enabling Sentry after ~6 weeks off. The repo
ConfigMap template keeps `SENTRY_DSN` empty; do not commit a DSN.

### Routing proof (confirmed, cutover day)

Public request to `/api/cutover-proof-25963` → 404; **k3s pod logs: 2 lines /
systemd logs: 0**. Public health, db-health, recipes, beans endpoints: 200.

### Applying or re-applying the default (B) manifests

```bash
kubectl apply -f deploy/oci/k3s/namespace.yaml
kubectl apply -f deploy/oci/k3s/configmap.yaml
# Secret must use bridge IP (see secret.example.yaml / §0 precondition 2):
#   postgres://brewdial_app:<pw>@10.42.0.1:5432/brewdial
kubectl apply -f deploy/oci/k3s/deployment.yaml
kubectl apply -f deploy/oci/k3s/service.yaml
```

### Switching to variant (A) — only with explicit operator intent

```bash
kubectl -n brewdial delete deploy brewdial-api
# stop or free :3020 if systemd fallback still binds it
kubectl apply -f deploy/oci/k3s/variant-a/deployment.yaml
# Secret DATABASE_URL → 127.0.0.1; cloudflared → :3020
```

### Traps found by CI (don't re-step on these)

1. **hostNetwork + `HOST=127.0.0.1` ⇒ `httpGet` probes never succeed.**
   The kubelet probes the *pod IP* — for hostNetwork pods that is the node IP,
   but the app binds loopback only. Result: rollout times out at 0/1 forever.
   Variant A therefore uses `exec` probes (`wget -qO- http://127.0.0.1:3020/...`,
   busybox wget is in the alpine base), which run inside the pod's netns.
   (CI run 31064047778 failed exactly this way.)
2. **hostNetwork pods claim their `containerPort`s at schedule time.**
   A second hostNetwork pod declaring :3020 on the same node is rejected by the
   scheduler's NodePorts plugin (`FailedScheduling: didn't have free ports`).
   This is the mechanical reason variant A must run `maxSurge=0` — and why any
   second copy of the Deployment (canary, debug, another namespace) must drop
   or remap the declared port. (CI run 31064541318 shows the live event.)


## 1. Operator: install k3s (one-time)

```bash
# SELinux is Enforcing — if install/start fails, suspect k3s-selinux FIRST.
curl -sfL https://get.k3s.io | sh -s - server \
  --disable=traefik --disable=servicelb --write-kubeconfig-mode=600
```

- Traefik/ServiceLB are disabled deliberately: ingress arrives via the
  cloudflared outbound tunnel and firewalld has zero open ports — nothing may
  bind 80/443. (k3s docs: Traefik's LoadBalancer Service uses ports 80/443.)
- Hard invariants: **no new firewalld openings** beyond the documented pod-CIDR
  rich rule in §0, **k3s API (6443) never exposed to the internet**.
- CI reaches the cluster ONLY via `kubectl` on the box over
  CF Tunnel + Access SSH. **Never put kubeconfig in GitHub secrets.**

## 2. Operator: first-time cluster setup

Production uses **variant (B)**. Secret `DATABASE_URL` must reach host Postgres
via the bridge IP (confirmed `10.42.0.1` — see §0). The loopback form is only
for variant (A) / recovery.

```bash
kubectl apply -f deploy/oci/k3s/namespace.yaml
kubectl apply -f deploy/oci/k3s/configmap.yaml
# real secret — values from /etc/brewdial/api.env adapted for bridge IP
# (never committed):
kubectl -n brewdial create secret generic brewdial-api-secret \
  --from-literal=DATABASE_URL='postgres://brewdial_app:<pw>@10.42.0.1:5432/brewdial' \
  --from-literal=AGENT_TOKEN='<openssl rand -hex 32>'
kubectl apply -f deploy/oci/k3s/deployment.yaml
kubectl apply -f deploy/oci/k3s/service.yaml
```

GHCR pull: if the package is public (repo is being flipped public), no pull
secret is needed. Otherwise: `kubectl -n brewdial create secret docker-registry
ghcr --docker-server=ghcr.io ...` + `imagePullSecrets` on the Deployment.

## 3. Deploy / update (CI does this; shown here for manual emergency use)

Images carry two tags: immutable `:sha-<short>` and moving `:latest`.
**Always deploy by digest.** Normal path is CI (see §7). Manual box commands
only for emergency when Actions is unavailable:

```bash
DIGEST=$(crane digest ghcr.io/mgh3326/brewdial:sha-<short>)   # or from the image.yml run log
kubectl -n brewdial set image deploy/brewdial-api \
  api=ghcr.io/mgh3326/brewdial@sha256:<digest> migrate=ghcr.io/mgh3326/brewdial@sha256:<digest>
kubectl -n brewdial patch configmap brewdial-api-config --type merge \
  -p '{"data":{"GIT_SHA":"<short>"}}'
kubectl -n brewdial rollout status deploy/brewdial-api
# health via NodePort (B), not the systemd port:
curl -fs localhost:30020/api/db/health
```

Migrations run in the pod's **initContainer** before the app starts — so a
deploy that includes migrations applies them automatically, and a failing
migration blocks the app from starting (rollout fails → see §4).

## 4. Rollback

### 4.1 Standard rollback — `workflow_dispatch` with prior `git_sha`

**Do not force-push `production` to roll back.** The standard path is a manual
Actions run of `Deploy OCI` with the previous healthy commit:

```bash
# previous healthy short or full SHA that still has ghcr.io/.../brewdial:sha-<short>
gh workflow run deploy-oci.yml -f git_sha=<prior-sha>
# then: gh run watch  (confirm DEPLOY_OK + imageID)
```

Requirements: that SHA must (1) be on `main`'s history and (2) still have a
GHCR image tag `sha-<7chars>`. The workflow refuses missing images and
refuses SHAs not reachable from `origin/main` (no silent fallback).

### 4.2 Emergency in-cluster image rollback

```bash
kubectl -n brewdial rollout history deploy/brewdial-api
kubectl -n brewdial rollout undo deploy/brewdial-api        # or: --to-revision=N
kubectl -n brewdial rollout status deploy/brewdial-api
```

This exact path (broken image → failed rollout → `rollout undo` → healthy) is
exercised in CI on every PR — see the `k8s-validate.yml` run log. Prefer §4.1
for intentional version selection; use undo when the just-deployed revision is
bad and the prior ReplicaSet is still known-good.

🔴 **Rollback does NOT undo migrations.** `rollout undo` restores the previous
pod spec; the database schema stays wherever the newer migration left it.
Therefore, once auto-migration is in the deploy path, **every migration must
follow expand/contract**: expand (add columns/tables, backfill, keep old code
working) in release N, contract (drop/renames) only in release N+1 after all
pods run N. Never ship a destructive migration in the same release as the code
that stops using the old shape — a rollback would then run old code against a
schema it can't handle.

### 4.2 Traffic rollback to systemd fallback (confirmed available)

While `brewdial-api.service` remains enabled on `:3020` (see §0 item 6 and §5.2):

1. Edit `/etc/cloudflared/config.yml` ingress service back to
   `http://127.0.0.1:3020` (backup files `.bak-*` exist on the box).
2. Reload/restart `cloudflared`.
3. Public traffic returns to the systemd stack without touching k3s or PG.

## 5. Cutover map — variant (B) path actually used (2026-08-06)

> **Confirmed path below.** The historical variant-(A) sketch follows for
> reference only; it was **not** the path production took.

### 5.1 Variant (B) — steps as executed

Order and impact:

| Step | Action | Live impact |
|---|---|---|
| 1 | firewalld rich rule (pod CIDR → 5432) | none to public traffic |
| 2 | Postgres `listen_addresses` + `pg_hba` + **restart** | 🔴 **only live-impact point** — active connections dropped; cutover had 0 active |
| 3 | Apply B manifests (Deployment + NodePort 30020); Secret uses bridge IP | k3s path ready; public still on systemd via cloudflared→:3020 |
| 4 | cloudflared ingress `:3020` → `:30020` + reload | traffic flips to k3s; **reversible** by editing config back |
| 5 | Leave systemd `brewdial-api` **running** on :3020 | dual-stack coexistence (B advantage vs A) |

**What is *not* a hard cutover dependency for B:** stopping systemd. Port
collision does not occur because NodePort 30020 ≠ 3020.

**Routing proof after step 4:** public `/api/cutover-proof-*` landed in k3s
pod logs only (see §0).

### 5.2 systemd cleanup — **after observation only** (do not do this now)

**Recommendation (not a current instruction):** after a stability observation
period of the operator's choosing, and only after an explicit operator
decision:

1. Confirm public traffic still hits k3s only (log correlation or a fresh
   proof path).
2. Confirm cloudflared still points at `:30020` and health on NodePort is green.
3. Then, and only then: `sudo systemctl disable --now brewdial-api` (or leave
   enabled-but-stopped per operator preference).

🔴 **Do not stop systemd as part of routine deploys.** Keeping it is the
fastest traffic rollback (cloudflared re-point only). Duration of the
observation window is an **operator decision**, not encoded here as a
deadline.

### 5.3 Variant (A) cutover sketch (reference only — not used in production)

If hostNetwork (A) had been chosen instead:

1. Deploy variant-a manifests only **after** freeing `:3020`.
2. 🔴 Downtime: `sudo systemctl stop brewdial-api` → pod binds `:3020`.
3. No cloudflared change for pure A (tunnel stays on `:3020`).
4. Dual-stack fallback is **not** available (port conflict with systemd).

## 6. Recovery bypass — k3s is down, serve via podman

If k3s itself is broken, run the **same image** directly (podman 5.x is
already on the box). This path mirrors **variant (A)** premises
(`--network host`, loopback DSN, cloudflared→:3020):

```bash
# 0. If cloudflared still points at NodePort 30020, re-point to :3020 first
#    (or after the container is up) so public traffic reaches the rescue.

# 1. apply any pending migrations first (idempotent, same image):
sudo podman run --rm --network host --env-file /etc/brewdial/api.env \
  ghcr.io/mgh3326/brewdial@sha256:<digest> \
  node /migrate/node_modules/node-pg-migrate/bin/node-pg-migrate.js \
    -m /migrate/migrations -j sql up

# 2. serve (hostNetwork → 127.0.0.1:3020):
sudo podman run -d --name brewdial-api-rescue --restart=always \
  --network host --env-file /etc/brewdial/api.env \
  ghcr.io/mgh3326/brewdial@sha256:<digest>

curl -fs localhost:3020/api/db/health
# when k3s is healthy again: sudo podman rm -f brewdial-api-rescue
# and restore cloudflared to :30020 if that is still the production path.
```

(`--network host` mirrors variant (A): `127.0.0.1:5432` DSN and the
cloudflared→3020 path both keep working **if** `/etc/brewdial/api.env` still
uses loopback for `DATABASE_URL`. SELinux Enforcing is fine here — no volumes
are mounted.)

**Note:** while the systemd unit still runs on `:3020`, free that port first
(`systemctl stop brewdial-api`) before the rescue container binds it.

## 7. CI release procedure (ROB-1214 Phase 2+)

Implemented workflow: `.github/workflows/deploy-oci.yml`.

### 7.1 Branch roles

| Branch | Role |
|---|---|
| **`main`** | CI baseline. Every push/PR runs CI Gate, k8s Validation, Container Image. Images are published as `ghcr.io/mgh3326/brewdial:sha-<7chars>` **only** from main (and same-repo PR builds). |
| **`production`** | **Release decision tip.** A push to `production` runs `Deploy OCI` and ships that commit's image digest to the live cluster. |

`main` green ≠ live. Live updates only when `production` moves (or when an
operator runs `workflow_dispatch`).

### 7.2 Standard promotion — fast-forward only

```bash
# From a machine with push rights (after main is green and image exists):
git fetch origin
git push origin main:production
# → Deploy OCI runs on the production push event for that SHA
```

**Why fast-forward is mandatory:** `image.yml` builds `sha-<short>` for commits
on `main`. A **merge-commit** promotion (`git checkout production && git merge
main && git push`) creates a **new** SHA that never went through the image
workflow → GHCR has no `sha-<new>` → deploy fails closed with:

```text
ERROR: no image for sha-XXXX (HTTP …)
production must be a fast-forward of main so GHCR has …:sha-XXXX
```

There is **no** fallback to “nearest ancestor image” — that would silently ship
different code than `production` HEAD.

**Past pitfall:** production was sometimes advanced with merge commits (e.g.
`c447085` had two parents). That pattern must not return. If `production` is
not an ancestor of `main`, fix history with an explicit operator decision
before the next release (do not invent SHAs in CI).

Check before promoting:

```bash
git fetch origin
git merge-base --is-ancestor origin/production origin/main && echo "ff-ok"
# Confirm image exists (Actions image run log, or registry HEAD):
#   ghcr.io/mgh3326/brewdial:sha-$(git rev-parse --short=7 origin/main)
```

### 7.3 What the deploy job does

1. Resolve target SHA (`GITHUB_SHA` on production push, or `git_sha` input on
   dispatch).
2. **Guard:** target must be an ancestor of `origin/main` (on main's history).
3. **Guard:** resolve `Docker-Content-Digest` for `sha-<7>`; missing → fail with
   the fast-forward message above (no alternate tag).
4. CF Access SSH → box-local `kubectl` with explicit
   `KUBECONFIG=$HOME/.kube/config` (non-interactive SSH does not load
   `.bashrc`).
5. Patch ConfigMap `GIT_SHA`, `kubectl set image` for `api` + `migrate` by
   **digest**, `rollout status`, NodePort health; on failure `rollout undo`.

Scope is **image + GIT_SHA only**. Manifest structure changes remain manual
`kubectl apply` by an operator (documented elsewhere in this runbook).

### 7.4 Manual deploy / standard rollback

```bash
# Deploy or roll back to a known-good main commit that still has a GHCR image:
gh workflow run deploy-oci.yml -f git_sha=<full-or-short-sha>
```

This is the **standard rollback** path (see §4.1). Prefer it over force-pushing
`production` or ad-hoc SSH.

### 7.5 Hard invariants (CI deploy path)

- No kubeconfig in GitHub secrets; no k3s API (6443) exposure; no new firewalld
  openings for deploy.
- No `pull_request_target` on the deploy workflow; minimal `permissions`;
  third-party Actions pinned by full SHA.
- No silent image substitution when `sha-<short>` is missing.

### 7.6 Audit — what is live

```bash
export KUBECONFIG=/home/opc/.kube/config
kubectl -n brewdial get configmap brewdial-api-config -o jsonpath='{.data.GIT_SHA}{"\n"}'
kubectl -n brewdial get pods -l app=brewdial-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{range .status.containerStatuses[*]}{.imageID}{"\n"}{end}{end}'
kubectl -n brewdial get deploy brewdial-api \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

Compare `GIT_SHA` / image digest to the Deploy OCI run log and GHCR tag
`sha-<short>`. Disagreement is drift.

## 8. Historical design notes (Phase 1 era)

Section 8 below recorded pre-implementation design options. **Production CI
deploy implemented option (c)** — `kubectl set image` + ConfigMap `GIT_SHA`
only (see §7). Manifest-wide apply remains operator-manual when structure
changes. Kept for context; §7 is normative for day-to-day release.

### 8.1 Options (historical)

| Option | Manifest location and apply path | Benefit | Cost / failure mode |
|---|---|---|---|
| **(a) Box git checkout** | CI connects through CF Access SSH; the box fetches the public repo at an exact commit and runs `kubectl apply -k` locally. | The box retains the manifest source and `git log` gives a local audit trail. No kubeconfig leaves the box. | Requires checkout ownership, disk hygiene, and a deploy identity on the box. A dirty checkout or branch tip would be unsafe, so the script must use detached full-SHA checkouts and fail closed. |
| **(b) CI streams manifests** | CI renders the selected manifests and sends them over SSH to box-local `kubectl apply -f -`. | No source checkout or deploy key is needed on the box. | The source of what is applied lives primarily in CI logs/artifacts; reconstructing “what is live now” is harder, and a truncated or mismatched stream is a dangerous failure mode. |
| **(c) `kubectl set image` only** — **implemented** | CI changes the image field on the existing Deployment and leaves manifests on the box unchanged. | Smallest command surface for an image-only release. | It cannot deliver ConfigMap structure, Secret, Service, policy, or variant changes. Those stay manual. |

### 8.2 Non-interactive SSH and `KUBECONFIG` (still normative)

The deploy script must explicitly export the kubeconfig before **every**
`kubectl` invocation. It must not rely on `.bashrc`, an interactive shell, or
kubectl's implicit fallback. The operator-managed file is
`/home/opc/.kube/config` (mode 600).

```bash
export KUBECONFIG=/home/opc/.kube/config
test -r "$KUBECONFIG"
kubectl config current-context
kubectl version --output=yaml
```

The CI job must never receive or store the kubeconfig; it only invokes
box-local kubectl over the already-approved CF Access SSH route.

## 9. Kotlin API (`api-kt`) — Phase 3 cutover (not yet executed)

> This is an operator-run Phase 3 procedure. ROB-1317 only adds the image
> workflow, manifests, and this runbook; it does not apply anything to the OCI
> box, k3s, cloudflared, or GHCR manually.

The Kotlin Deployment is deliberately separate from `brewdial-api`: its app
label is `brewdial-api-kt`, its Service is NodePort **30021**, and its
initContainer keeps using the existing Node image and `/migrate` command. The
current Node Deployment and NodePort **30020** must remain intact throughout
the cutover and the one-week observation period.

### 9.1 Confirm immutable images before changing the cluster

1. Wait for this PR's **Kotlin API Container Image** Actions run to be green.
   Copy the `Digest:` for `ghcr.io/mgh3326/brewdial-api-kt:sha-<short>` from
   `docker buildx imagetools inspect`; do not use `:latest`.
2. Select the known-good, digest-pinned Node image for the `migrate`
   initContainer. It remains the migration implementation for this cutover.
3. In `deploy/oci/k3s/api-kt/deployment.yaml`, replace each
   `REPLACE_WITH_RELEASE_DIGEST`: the `migrate` image gets the selected Node
   digest and the `api` image gets the Kotlin image digest. Review the rendered
   image strings before applying; never commit a real replacement digest as an
   accidental substitute for an audited release decision.

### 9.2 Prepare the parallel Kotlin path (box-local kubectl only)

On the OCI box, with the operator-managed kubeconfig from §8.2:

```bash
kubectl apply -f deploy/oci/k3s/api-kt/configmap.yaml
kubectl apply -f deploy/oci/k3s/api-kt/deployment.yaml
kubectl apply -f deploy/oci/k3s/api-kt/service.yaml
kubectl -n brewdial rollout status deploy/brewdial-api-kt
curl -fsS localhost:30021/api/db/health
```

Do not alter `brewdial-api`, `brewdial-api` Service, or the current
cloudflared ingress at this stage. Capture comparable baseline and Kotlin
measurements if desired (the script makes 100 loopback health requests):

```bash
deploy/oci/k3s/measure-api.sh brewdial-api 30020
deploy/oci/k3s/measure-api.sh brewdial-api-kt 30021
```

### 9.3 Flip traffic only after NodePort 30021 is healthy

Back up `/etc/cloudflared/config.yml`, edit its ingress service from
`http://127.0.0.1:30020` to `http://127.0.0.1:30021`, then restart
cloudflared using the box's existing service manager. Confirm public health
and database-health traffic after the restart. This is the only traffic flip;
the old Deployment remains live as the rollback target.

### 9.4 Observe for one week, then roll back by ingress if needed

For one full week, keep both Deployments and both Services running. Review
Kotlin pod restarts, startup time, cgroup memory values, p50/p99 health timing,
and public error signals. Do **not** stop or delete the Node Deployment during
this observation window.

If Kotlin traffic must be rolled back, change the cloudflared ingress back
from `http://127.0.0.1:30021` to `http://127.0.0.1:30020`, restart
cloudflared, and verify `curl -fsS localhost:30020/api/db/health`. Leave the
old Node Deployment in place; no Kubernetes rollback is required for the
traffic reversal.

`deploy-oci.yml` remains **Node API only**. It does not deploy, update, or
roll back `brewdial-api-kt`; any Phase 3 Kubernetes action requires explicit
operator attendance.
