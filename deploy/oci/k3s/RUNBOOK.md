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

Production has **not selected A or B**. Phase 1 validates both shapes, while
the first-cutover approval must select exactly one and record the choice with
the release. Variant (A) avoids a production Postgres change; variant (B)
preserves zero-downtime rolling updates but requires the operator-approved
Postgres and cloudflared changes shown below. The Phase 2 deployment path must
apply the approved variant overlay and must not silently choose one:

```bash
kubectl -n brewdial delete deploy brewdial-api
# 1. operator: PG listen_addresses += <cni0/bridge IP>, pg_hba += pod CIDR (scram)
# 2. edit Secret: DATABASE_URL → postgres://brewdial_app:<pw>@<bridge-ip>:5432/brewdial
kubectl apply -f deploy/oci/k3s/variant-b/
# 3. cloudflared: service http://127.0.0.1:30020  (was :3020)
```

The bridge IP / pod CIDR are only knowable after k3s is installed
(`ip addr show cni0`, `kubectl get node -o jsonpath='{.spec.podCIDR}'`).

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
- Hard invariants: **no new firewalld openings**, **k3s API (6443) never
  exposed to the internet**.
- CI reaches the cluster ONLY via `kubectl` on the box over
  CF Tunnel + Access SSH. **Never put kubeconfig in GitHub secrets.**

## 2. Operator: first-time cluster setup

The following Secret example is for variant (A) only. Do not apply it until
the cutover approval records the selected variant. Variant (B) must use the
node-reachable Postgres address and the approved `pg_hba`/`listen_addresses`
change described in §0.

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

## 8. Phase 2 design — manifest placement and apply contract (design only)

This section defines the missing source-of-truth contract for CI deployment.
It does not add the Phase 2 workflow, a box checkout, a kustomization, or a
production Deployment. Those are separate implementation and cutover work.

### 8.1 Options

| Option | Manifest location and apply path | Benefit | Cost / failure mode |
|---|---|---|---|
| **(a) Box git checkout** | CI connects through CF Access SSH; the box fetches the public repo at an exact commit and runs `kubectl apply -k` locally. | The box retains the manifest source and `git log` gives a local audit trail. No kubeconfig leaves the box. | Requires checkout ownership, disk hygiene, and a deploy identity on the box. A dirty checkout or branch tip would be unsafe, so the script must use detached full-SHA checkouts and fail closed. |
| **(b) CI streams manifests** | CI renders the selected manifests and sends them over SSH to box-local `kubectl apply -f -`. | No source checkout or deploy key is needed on the box. | The source of what is applied lives primarily in CI logs/artifacts; reconstructing “what is live now” is harder, and a truncated or mismatched stream is a dangerous failure mode. |
| **(c) `kubectl set image` only** | CI changes the image field on the existing Deployment and leaves manifests on the box unchanged. | Smallest command surface for an image-only release. | It cannot deliver ConfigMap, Secret, Service, migration, policy, or variant changes. Manifest drift is inevitable unless a second apply path is added. |

### 8.2 Recommendation: (a), with an immutable release tuple

Recommend **(a) box git checkout**. This preserves the manifest source beside
the cluster, makes the applied commit independently inspectable with `git
show`/`git log`, and keeps the kubeconfig on the box. The trade is an extra
box-side checkout and strict handling of its state; those are controlled and
observable, whereas option (b)'s source-only-in-CI audit gap and option (c)'s
manifest drift are harder to recover from.

The checkout should be a dedicated deployment checkout (for example
`/opt/brewdial-k3s`) rather than overwriting the current rsync copy while the
systemd service is still live. Before cutover, the operator must choose the
final path and ownership. The checkout must be clean and detached at the
release's **full** commit SHA; it must never deploy the moving `main` tip.

The release identity is the tuple:

```
(manifest commit SHA, image repository, image digest, selected variant)
```

The Phase 2 implementation must make this tuple one input to one apply. The
image workflow already produces an immutable `:sha-<short>` tag and records
the GHCR digest. The deploy job must consume that exact digest for the same
full commit SHA, verify the box checkout is at that SHA, and render the
selected kustomize overlay so both the API container and migration
initContainer use `ghcr.io/...@sha256:<digest>`. Moving tags such as `:latest`
are for discovery only and must not appear in the applied Deployment.

The resulting Deployment should carry the full commit SHA, image digest, and
selected variant as labels or annotations, and the release record should
include the CI run URL. The kustomization/overlay contract must expose the
variant as an explicit input; this design intentionally does **not** declare
variant (A) or (B) as the production default.

The intended Phase 2 sequence is:

1. CI builds and pushes the image, then obtains its immutable digest for
   `GITHUB_SHA`.
2. Over CF Access SSH, CI runs a non-interactive box-side script. The script
   fetches the exact full SHA, checks out detached and clean, verifies
   `git rev-parse HEAD` equals the release SHA, and checks that the selected
   variant is an approved input.
3. The script binds the CI-provided digest to the checked-out kustomize
   overlay, runs `kubectl apply -k`, waits for rollout/readiness and health,
   and writes the release tuple plus CI run URL to the box's release ledger.
4. The script prints the applied commit, digest, variant, Deployment
   revision, and health result. A mismatch, dirty tree, unavailable digest,
   unreadable kubeconfig, or failed rollout exits non-zero before declaring
   success.

### 8.3 Audit: determining what is applied now

The operator can answer “what version is in the cluster?” without trusting a
moving tag by comparing the Deployment metadata, its image digest, the box
checkout, and the CI release record:

```bash
export KUBECONFIG=/home/opc/.kube/config
kubectl -n brewdial get deploy brewdial-api \
  -o jsonpath='{.metadata.annotations.brewdial\.rob1215/release-sha}{"\n"}{.metadata.annotations.brewdial\.rob1215/image-digest}{"\n"}{.spec.template.spec.containers[*].image}{"\n"}'
kubectl -n brewdial rollout history deploy/brewdial-api
cd /opt/brewdial-k3s && git rev-parse HEAD && git log -1 --oneline
```

The annotation values, the digest-qualified API and migration images, the
detached checkout's `git rev-parse HEAD`, and the release ledger/CI run URL
must agree. `kubectl describe`/`get -o yaml` is the cluster-side evidence;
`git show <SHA>:deploy/oci/k3s/` is the manifest-side evidence. A disagreement
is drift, not a successful deployment, and must stop further releases until
reconciled.

### 8.4 Rollback: restore manifest and image together

Rollback is a release rollback, not merely `kubectl set image`:

1. Identify the last healthy release tuple from the annotations, rollout
   history, and box release ledger. Confirm its image digest still exists in
   GHCR.
2. Fetch and check out that prior manifest commit detached on the box. Render
   the same selected variant with the prior digest and verify that both the
   API and migration initContainer point to it.
3. Apply that complete manifest set with the explicit `KUBECONFIG`, wait for
   rollout and health, then verify the cluster annotations and image digests
   equal the prior tuple. Keep `kubectl rollout undo` as an emergency shortcut
   only when the prior PodTemplate is known to contain the exact same
   manifest and digest; it is not the normal cross-version rollback path.
4. Record the rollback reason, source and target tuples, operator, time, and
   health result in the CI/box release records.

`rollout undo` and a digest rollback do not undo database migrations. The
existing expand/contract rule remains mandatory: a release may expand the
schema while old code remains compatible; destructive contract work waits
 for a later release. If a rollback meets an incompatible schema, stop and
 use the separately approved database recovery procedure rather than issuing
 an automatic down migration.

### 8.5 Non-interactive SSH and `KUBECONFIG`

The deploy script must explicitly export the kubeconfig before **every**
`kubectl` invocation. It must not rely on `.bashrc`, an interactive shell, or
kubectl's implicit fallback. The operator-managed file in this design is
`/home/opc/.kube/config` (mode 600); if the operator instead chooses the k3s
default `/etc/rancher/k3s/k3s.yaml`, the script must run kubectl with the
required privilege and an explicit `KUBECONFIG` value because that file is
root-readable only.

The preflight must be equivalent to:

```bash
export KUBECONFIG=/home/opc/.kube/config
test -r "$KUBECONFIG"
kubectl config current-context
kubectl version --output=yaml
```

An unreadable or unexpected kubeconfig is a hard failure. The CI job must
never receive or store the kubeconfig; it only invokes box-local kubectl over
the already-approved CF Access SSH route.
