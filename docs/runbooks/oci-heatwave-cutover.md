# OCI: k3s → shiftgate, then PostgreSQL → HeatWave MySQL (ROB-1435)

The OCI host runs a single `brewdial-api` pod on k3s, and k3s alone costs about
800 MB RSS. This runbook replaces k3s with
[shiftgate](https://github.com/mgh3326/shiftgate): blue-green Docker
containers behind one HAProxy, deployed by digest from CI. It then moves the
API to the Kotlin service (`apps/api-kt`) on OCI HeatWave MySQL. PostgreSQL
stays available the whole time as the rollback target.

| Phase | What changes | Rollback |
|---|---|---|
| 1. Host preparation | Docker, shiftgate, HAProxy container, env files, deploy key | Nothing is serving from it yet |
| 2. Cutover k3s → shiftgate | cloudflared `:30020` (k3s) → `:8020` (shiftgate, Node API, PostgreSQL) | Point cloudflared back to `:30020` |
| 3. k3s removal | `systemctl disable --now k3s` and remove its files later | Until the files are removed: `systemctl start k3s` |
| 4. Node → api-kt on HeatWave MySQL | Data copy with verification, `brewdial-api-kt` blue (PostgreSQL) → green (MySQL), cloudflared → `:8021` | `shiftgate rollback brewdial-api-kt` (back to the PostgreSQL colour), or cloudflared → `:8020` (Node) |

Run phases 1–3 together. Phase 4 is a separate change window.

Conventions:

- `$` runs as `opc` with `sudo`. Commands never print secrets.
- **Database credentials are referenced only by env-file path.** The files
  are `/etc/shiftgate/brewdial-api.env` and `/etc/shiftgate/brewdial-api-kt.env`
  (owner `root:root`, mode `0600`). shiftgate passes them to `docker run
  --env-file` and never opens them. They are never committed, pasted into
  tickets, or shown with `cat`. Set or check a key with `sudoedit`, or with
  `sudo grep -c '^DATABASE_URL=' <file>` (which prints a count, not the value).
- Repository config: `deploy/oci/shiftgate/services.yaml` (the host file) and
  `.github/workflows/deploy-oci.yml` (CI deploys).

---

## 1. Host preparation

1. **Docker.** k3s ships its own containerd, so Docker is a separate install.
   Install `docker-ce` for Oracle Linux 9 (aarch64) and run `sudo systemctl
   enable --now docker`.
2. **shiftgate.** Build the binary for linux/arm64 from the pinned revision,
   (`.github/workflows/shiftgate-render.yml` pins c65b3a4428c9 for rendering only; the host needs `follow`, added in d0cc564):
   ```sh
   git clone https://github.com/mgh3326/shiftgate && cd shiftgate && git checkout d0cc564   # first revision with `shiftgate follow`
   CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o shiftgate ./cmd/shiftgate
   # Copy the binary to the host if you built it elsewhere, then on the host:
   sudo install -m 0755 shiftgate /usr/local/bin/shiftgate
   ```
3. **Config.** Install the repository file:
   ```sh
   sudo install -d -m 0755 /etc/shiftgate /etc/shiftgate/haproxy /var/lib/shiftgate /run/shiftgate-haproxy
   sudo install -m 0644 deploy/oci/shiftgate/services.yaml /etc/shiftgate/services.yaml
   ```
   To keep `/run/shiftgate-haproxy` across reboots, add a `tmpfiles.d` entry:
   `d /run/shiftgate-haproxy 0755 99 99 -`. uid 99 is the `haproxy` user in
   the official image.
4. **HAProxy container.** Oracle Linux 9 ships HAProxy 2.4, and shiftgate needs
   2.8 or newer. Run the pinned official image with host networking from a
   systemd unit named `shiftgate-haproxy.service`:
   ```ini
   [Unit]
   After=docker.service
   Requires=docker.service
   [Service]
   ExecStartPre=-/usr/bin/docker rm -f shiftgate-haproxy
   ExecStart=/usr/bin/docker run --name shiftgate-haproxy --network host \
     -v /etc/shiftgate/haproxy:/etc/shiftgate/haproxy:ro \
     -v /run/shiftgate-haproxy:/run/shiftgate-haproxy \
     docker.io/library/haproxy:3.0@sha256:263a38dfde928f83104d86a4e1a659317ce988fa29535f76335046c91e291a98 \
     haproxy -W -db -f /etc/shiftgate/haproxy/haproxy.cfg
   ExecStop=/usr/bin/docker stop shiftgate-haproxy
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
   Render once before starting it. Every colour starts disabled.
   ```sh
   sudo shiftgate render --no-reload        # validates with haproxy -c, writes the file
   sudo systemctl enable --now shiftgate-haproxy
   sudo shiftgate status
   ```
5. **Env file for `brewdial-api` (Node API, PostgreSQL).** Copy the keys from
   `/etc/brewdial/api.env` without displaying them:
   ```sh
   sudo install -m 0600 -o root -g root /dev/null /etc/shiftgate/brewdial-api.env
   sudo sh -c 'grep -E "^(DATABASE_URL|AGENT_TOKEN|SENTRY_DSN)=" /etc/brewdial/api.env > /etc/shiftgate/brewdial-api.env'
   sudo grep -c '^DATABASE_URL=postgres://' /etc/shiftgate/brewdial-api.env   # expect 1
   ```
   `DATABASE_URL` must use `127.0.0.1`, not the k3s bridge IP `10.42.0.1`,
   because the container uses host networking. Leave `PORT`, `HOST` and
   `GIT_SHA` out of the file: shiftgate sets `PORT` to the colour port,
   services.yaml sets `HOST`, and the image bakes in `GIT_SHA`.
6. **Registry login.** If the GHCR packages are private, log in once as the
   user that runs shiftgate. Use a token with `read:packages` only.
7. **Pull-based deploys (no CI access to the host).** CI only builds, pushes
   and, on a release, moves the `production` tag. The host follows it:
   Dagu on this host runs every few minutes
   `sudo shiftgate follow brewdial-api --tag production`. No deploy user, SSH
   key, tailnet OAuth client or repository secret is needed. The image is a
   public GHCR package; if it ever becomes private, log in once on the host
   with a `read:packages` token.

## 2. Cutover: k3s → shiftgate (Node API, PostgreSQL)

k3s keeps serving on `127.0.0.1:30020` throughout. shiftgate serves on
`127.0.0.1:8020`. The cutover itself is the cloudflared ingress line.

1. **First deploy, from CI or by hand.** Use the digest that k3s serves now,
   so the cutover changes nothing but the runtime:
   ```sh
   kubectl -n brewdial get deploy brewdial-api -o jsonpath='{.spec.template.spec.containers[0].image}'   # …@sha256:<digest>
   sudo shiftgate deploy brewdial-api --digest sha256:<digest>
   sudo shiftgate status
   curl -fsS http://127.0.0.1:8020/api/health && curl -fsS http://127.0.0.1:8020/api/db/health
   ```
   The container runs `node-pg-migrate up` before the server starts, as the
   k3s initContainer did. Against the current database it is a no-op, because
   `pgmigrations` already lists every migration.
2. **Releases from CI.** Fast-forward `production` to the `main` commit you
   intend to ship (`git push origin main:production`). The workflow builds it,
   pushes it and moves `ghcr.io/mgh3326/brewdial:production` to that digest.
   Within a few minutes the host follower deploys it into the idle colour,
   which also makes `shiftgate rollback` available. Check `shiftgate status`
   for the new digest. A rolled-back digest is held by the follower until a
   newer one is tagged.
3. **Switch traffic.** In `/etc/cloudflared/config.yml`, change the ingress
   from `http://127.0.0.1:30020` to `http://127.0.0.1:8020`. Then run `sudo
   systemctl restart cloudflared` and check the public `/api/health` and
   `/api/db/health`.
4. **Watch for one day.** Check the `shiftgate status` and `docker logs
   shiftgate-brewdial-api-<colour>` output, and Sentry.

**Rollback (phase 2):** point cloudflared back to `http://127.0.0.1:30020` and
restart it. k3s is still running. Both runtimes use the same PostgreSQL, so no
data moves. For a bad image on shiftgate, run `sudo shiftgate rollback
brewdial-api`. It starts the kept previous colour, health-checks it, and flips
HAProxy back.

## 3. k3s removal (desk)

Do this after phase 2 has been stable for the observation period.

1. Stop k3s and keep its files, so this step stays reversible:
   ```sh
   sudo systemctl disable --now k3s
   sudo /usr/local/bin/k3s-killall.sh      # stops leftover pods and containerd shims; keeps /var/lib/rancher
   free -m                                  # expect about 800 MB back
   ```
2. **Keep for rollback until the next phase-4 window closes:**
   - `/etc/rancher/k3s/` (kubeconfig, registries) and `/var/lib/rancher/k3s/`
     (cluster state and images);
   - `deploy/oci/k3s/` and `.github/workflows/deploy-oci-k3s.yml` in the
     repository (manual dispatch only, marked deprecated);
   - the host PostgreSQL listener on the bridge IP `10.42.0.1` and its
     pod-CIDR `pg_hba` line.

   To bring k3s back: `sudo systemctl enable --now k3s`, wait for the pod to
   become ready, then point cloudflared back to `:30020`.
3. **Final removal** (a later, separate change): run
   `/usr/local/bin/k3s-uninstall.sh`. Then delete `deploy/oci/k3s/`,
   `deploy-oci-k3s.yml` and the k3d `k8s-validate.yml` job in one PR. Also
   remove the `10.42.0.1` PostgreSQL listener and its `pg_hba` line.

## 4. Node → api-kt on HeatWave MySQL

`apps/api-kt` runs on PostgreSQL or MySQL through JPA/Hibernate. The
`DATABASE_URL` scheme selects the vendor: `postgres://…` or `mysql://…`. At
startup, Flyway applies `db/migration/postgresql` or `db/migration/mysql`,
which have the same schema meaning. CI runs the full suite against both
databases (`ci-kt.yml`). PostgreSQL support stays permanently.

### 4.1 Preconditions

- **HeatWave.** The DB system runs MySQL 8.4 LTS or newer in the private
  subnet. Its security list allows TCP 3306 from the host's subnet only.
  Create the database and an application user: `create database brewdial;`
  and grant all on `brewdial.*`. The user creates triggers, so with binary
  logging on it also needs `log_bin_trust_function_creators=ON` in the DB
  system configuration, or an equivalent privilege. Test this once with
  `create trigger` in a scratch schema.
- **Env file for `brewdial-api-kt`.** Create
  `/etc/shiftgate/brewdial-api-kt.env` (`0600`) with `AGENT_TOKEN`,
  `SENTRY_DSN` and, first, the **PostgreSQL** `DATABASE_URL`
  (`postgres://brewdial_app:…@127.0.0.1:5432/brewdial`).
- **Env file for the copy.** Create `/etc/shiftgate/brewdial-copy.env`
  (`0600`) with two keys: `DATABASE_URL`, the HeatWave target
  (`mysql://app:…@<private-ip>:3306/brewdial?sslMode=REQUIRED`), and
  `BREWDIAL_COPY_SOURCE_URL`, the PostgreSQL source. Passing them by file keeps
  the passwords out of the process list. Step 4.4 moves the HeatWave URL into
  the api-kt env file.
- **PostgreSQL is at migration 007.** Run `select name from pgmigrations order
  by run_on;`. On its first start against this database, api-kt's Flyway
  records it as baseline V1 (`baseline-on-migrate`), and V1 equals
  `packages/db/migrations` 001–007. `PostgresBaselineDriftTest` keeps the two
  in sync.
- **Values fit the MySQL key columns.** MySQL needs bounded `VARCHAR` columns
  where PostgreSQL indexes unbounded `text`. Each count must be 0:
  ```sql
  select 'beans.name/roaster' c, count(*) from beans where char_length(name) > 255 or char_length(roaster) > 255
  union all select 'bean ids', count(*) from beans where char_length(id) > 128
  union all select 'recipe codes', count(*) from recipes where char_length(code) > 64
  union all select 'calibration labels', count(*) from grinder_calibration
    where char_length(from_label) > 255 or char_length(to_label) > 255 or char_length(anchor_method) > 120
  union all select 'preferences.id', count(*) from preferences where char_length(id) > 64
  union all select 'bd_migration_meta.key', count(*) from bd_migration_meta where char_length(key) > 128;
  ```
  The copy repeats this check for every bounded column before it writes
  anything, and refuses with the list of oversized values.

### 4.2 Parity precheck: Node API vs api-kt

The cutover changes the runtime and the database at once, so check them
separately:

1. **Contract suite.** The `ci-kt.yml` PostgreSQL job runs the Node API's
   Vitest contract suite against Spring (`scripts/contract-test.sh`). The
   latest `main` run must be green.
2. **Route inventory.** Every Hono route must have a Spring mapping. Compare
   the two lists and explain every difference:
   ```sh
   grep -rhoE --exclude='*.test.ts' "\.(get|post|put|patch|delete)\(\s*'[^']+'" apps/api/src | sort -u
   grep -rhoE '@(Get|Post|Put|Patch|Delete)Mapping\("[^"]*"' apps/api-kt/src/main | sort -u
   ```
   The documented intentional differences are in `apps/api-kt/README.md`.
3. **Same data, both runtimes.** Deploy api-kt on **PostgreSQL** (colour blue)
   with `sudo shiftgate deploy brewdial-api-kt --digest sha256:<api-kt
   digest>`. It listens on `127.0.0.1:8021` and receives no public traffic.
   Then compare read endpoints against the Node API on `:8020`:
   ```sh
   for p in /api/beans /api/recipes /api/grinders /api/drippers /api/preferences/global; do
     diff <(curl -fsS "http://127.0.0.1:8020$p" | jq -S .) <(curl -fsS "http://127.0.0.1:8021$p" | jq -S .) \
       && echo "same: $p" || echo "DIFF: $p"
   done
   ```
   The only allowed differences are the ones in the README (timestamp
   precision, numeric JSON types). Stop here if anything else differs.

### 4.3 Copy and verify: PostgreSQL → MySQL

The copy runs the api-kt image in its copy mode. Flyway first creates the
MySQL schema and Hibernate validates it. Then every table is copied in
foreign-key order, inside one PostgreSQL snapshot. The MySQL insert triggers
are bypassed (`@bd_replication_role='replica'`, the equivalent of PostgreSQL
`session_replication_role`). The copy also carries over `recipe_code_seq`.
Finally, each table is verified:

- **row count**: PostgreSQL vs MySQL;
- **checksum**: SHA-256 over every row in a vendor-neutral canonical form
  (UUIDs as text, JSON with sorted keys and normalised numbers, `text[]` as
  JSON arrays, timestamps as UTC instants, every value length-prefixed), rows
  sorted.

1. **Freeze writes.** Point cloudflared at a maintenance response
   (`service: http_status:503`) and restart it. The data is small, so the
   window is minutes. The Node API keeps running on `:8020`.
2. **Copy**, with both URLs coming from the copy env file:
   ```sh
   sudo docker run --rm --network host \
     --env-file /etc/shiftgate/brewdial-copy.env \
     -e SPRING_MAIN_WEB_APPLICATION_TYPE=none -e BREWDIAL_COPY_MODE=copy \
     ghcr.io/mgh3326/brewdial-api-kt@sha256:<api-kt digest>
   ```
   The output ends with a table (`TABLE  POSTGRES_ROWS  MYSQL_ROWS
   POSTGRES_SHA256  MYSQL_SHA256  RESULT`) and with `COPY_VERIFY_OK
   tables=15`, exit code 0. Any `MISMATCH` exits non-zero: stop, keep the
   freeze, and investigate. The copy refuses a non-empty target, so to retry,
   drop and recreate the HeatWave database first.
3. **Re-verify** just before the switch, still frozen. Run the same command
   with `-e BREWDIAL_COPY_MODE=verify`. It copies nothing and repeats the
   counts and checksums. Save the output with the change record.

### 4.4 Cutover through shiftgate

1. Move the HeatWave `DATABASE_URL` into `/etc/shiftgate/brewdial-api-kt.env`
   with `sudoedit`, replacing the PostgreSQL line. The PostgreSQL URL stays in
   `/etc/shiftgate/brewdial-copy.env` as `BREWDIAL_COPY_SOURCE_URL`.
2. Deploy the **same** api-kt digest again. shiftgate starts the idle colour
   (green) with the new env file, health-checks `/api/db/health` against
   MySQL, and flips HAProxy on `:8021`:
   ```sh
   sudo shiftgate deploy brewdial-api-kt --digest sha256:<api-kt digest>
   sudo shiftgate status    # brewdial-api-kt ACTIVE=green, PREVIOUS=blue (the PostgreSQL colour)
   ```
   Do not run `shiftgate prune` or another api-kt deploy until the rollback
   window closes. Blue is the PostgreSQL rollback target, and shiftgate keeps
   only that one previous container.
3. Switch traffic: set the cloudflared ingress to `http://127.0.0.1:8021`
   and restart cloudflared. This also ends the write freeze.
4. Smoke test: run public `/api/health`, `/api/db/health` and a read, then
   one agent write through MCP. Check Sentry.
5. Point CI at api-kt: change `deploy-oci.yml` to build `apps/api-kt` and
   deploy `brewdial-api-kt`. Do this in a follow-up PR, after the window.

### 4.5 Rollback to the PostgreSQL colour

- **api-kt on PostgreSQL** (keeps the Kotlin runtime): run `sudo shiftgate
  rollback brewdial-api-kt`. It starts the kept blue container, which still
  has the PostgreSQL env it was created with, health-checks it, and flips
  `:8021` back. Running the command again rolls forward to MySQL.
- **Node API on PostgreSQL** (the phase-2 state): set the cloudflared ingress
  back to `http://127.0.0.1:8020` and restart cloudflared. `brewdial-api` was
  never stopped.

**Data written after the cutover exists only in MySQL.** The copy runs one
way only, so a rollback after real writes loses them. Before you roll back,
list the affected rows on MySQL:
`select … where created_at > '<cutover UTC>' or updated_at > '<cutover UTC>'`
for every table. Then re-apply them to PostgreSQL by hand or accept the loss.
Decide this before step 4.4.3, and keep the rollback window short (hours).

After the window, keep PostgreSQL running and backed up (ROB-630) until the
desk retires it. api-kt keeps working against it, which other environments
and future rollbacks need.
