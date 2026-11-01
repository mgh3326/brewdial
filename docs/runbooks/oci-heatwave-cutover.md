# OCI: k3s → shiftgate, then PostgreSQL → HeatWave MySQL (ROB-1435)

The OCI host runs a single `brewdial-api` pod on k3s, and k3s alone costs about
800 MB RSS. This runbook replaces k3s with
[shiftgate](https://github.com/mgh3326/shiftgate): blue-green Docker
containers behind one HAProxy, deployed by digest from CI. It then moves the
API to the Kotlin service (`apps/api-kt`) on OCI HeatWave MySQL. PostgreSQL
stays the rollback target until the desk retires it (§4.7). `apps/api-kt` is the
only API after phase 4: the Node API (`apps/api`) and `packages/db` retire with
PostgreSQL.

| Phase | What changes | Rollback |
|---|---|---|
| 1. Host preparation | Docker, shiftgate, HAProxy container, env files, deploy key | Nothing is serving from it yet |
| 2. Cutover k3s → shiftgate | cloudflared `:30020` (k3s) → `:8020` (shiftgate, Node API, PostgreSQL) | Point cloudflared back to `:30020` |
| 3. k3s removal | `systemctl disable --now k3s` and remove its files later | Until the files are removed: `systemctl start k3s` |
| 4. Node → api-kt on HeatWave MySQL | Scripted maintenance window: stop the Node API, copy, verify, start `brewdial-api-kt` on MySQL, parity, then cloudflared → `:8021` | Scripted (§4.5): stop api-kt, copy MySQL → PostgreSQL only if MySQL took writes, start the Node API, cloudflared → `:8020` |

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
- **PostgreSQL role.** The application role owns the tables. The rollback copy
  needs that: an owner may disable user triggers, and no superuser is involved.
  The copy checks this at cutover and refuses otherwise.
- **Scripts on the host.** `/opt/brewdial` holds a checkout of a commit that
  contains `deploy/oci/heatwave-phase4.sh` (rsync as in `deploy/oci/README.md`).
- **Nothing else may start a colour during the window.** Pause every Dagu job that
  runs `shiftgate follow` or `shiftgate check --heal`, and do not move `production`,
  from the start of the window until the rollback window closes. Either could bring
  the stopped Node API back as a writer. The script stops if it finds the Node API
  running again before it finishes, but the jobs must be paused.
- **Tell users.** Public traffic gets a 503 from the moment the Node API stops until
  the switch: a few minutes, planned in advance. Read and write both stop.
- **Env file for `brewdial-api-kt`.** Create
  `/etc/shiftgate/brewdial-api-kt.env` (`0600`) with `AGENT_TOKEN`,
  `SENTRY_DSN` and the **HeatWave** `DATABASE_URL`, the same value as in the copy
  env file below.
- **Env files for the copy.** Create `/etc/shiftgate/brewdial-copy.env`
  (`0600`) with two keys: `DATABASE_URL`, the HeatWave target
  (`mysql://app:…@<private-ip>:3306/brewdial?sslMode=REQUIRED`), and
  `BREWDIAL_COPY_SOURCE_URL`, the PostgreSQL source. Passing them by file keeps
  the passwords out of the process list. Then derive the rollback file, which
  swaps the two directions, without displaying it:
  ```sh
  sudo sh -c 'umask 077; sed -nE "s/^DATABASE_URL=/BREWDIAL_COPY_SOURCE_URL=/p; t; s/^BREWDIAL_COPY_SOURCE_URL=/DATABASE_URL=/p" /etc/shiftgate/brewdial-copy.env > /etc/shiftgate/brewdial-rollback.env'
  sudo grep -cE '^(DATABASE_URL=postgres|BREWDIAL_COPY_SOURCE_URL=mysql)' /etc/shiftgate/brewdial-rollback.env   # expect 2
  ```
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
- **Names stay unique on MySQL.** `utf8mb4_0900_as_cs` treats the composed and
  decomposed forms of one Korean name as equal, and PostgreSQL does not. A pair
  stops the copy on a duplicate key. Each query must return no rows:
  ```sql
  select lower(normalize(name)), coalesce(lower(normalize(roaster)), ''), count(*) from beans group by 1, 2 having count(*) > 1;
  select lower(normalize(name)), count(*) from grinders group by 1 having count(*) > 1;
  select lower(normalize(name)), count(*) from drippers group by 1 having count(*) > 1;
  ```
- **No manual loaders during the window.** `scripts/kurly/load.mjs --execute` and
  `load:xbloom-reference` write to PostgreSQL directly. Do not run them from the start
  of the window until the rollback window closes. A write during the copy would be lost.

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

The window then compares api-kt on **MySQL** with responses saved from the Node API
just before it stops (§4.3).

### 4.3 The window: stop, copy, verify, start

The database is about 10 MB, so this is a short planned maintenance window. Nothing
runs against a database while it is copied, so no write can land during the copy.

Rehearse first. `--preflight` runs only the read-only checks and changes nothing:

```sh
sudo /opt/brewdial/deploy/oci/heatwave-phase4.sh cutover --digest sha256:<api-kt digest> --preflight
```

Then run the window:

```sh
sudo /opt/brewdial/deploy/oci/heatwave-phase4.sh cutover --digest sha256:<api-kt digest>
```

The script stops at the first failed step, prints `PHASE4_FAILED step=<step>` and
exits non-zero. Tool output goes to `/var/log/brewdial-phase4/` (`0700`), with
connection credentials redacted.

| Step | What it does | Passes when |
|---|---|---|
| `preflight` | Reads the env files by path, shiftgate state and health | Every file is `0600` with the right keys, the Node API has an active colour, and no finished cutover stands |
| `save` | Saves the Node API's answers to the read endpoints, for `parity` | Every endpoint answers |
| `stop` | Stops every colour of the Node API, and any api-kt | Each container reports not running, and `:8020` no longer answers |
| `copy` | Copies PostgreSQL → MySQL in one snapshot, and compares before it commits | `COPY_VERIFY_OK` and exit 0 |
| `verify` | Compares both databases in a new snapshot | `COPY_VERIFY_OK` |
| `start` | `shiftgate deploy brewdial-api-kt` on MySQL | It is active on this digest, and `/api/db/health` on `:8021` answers 200 |
| `parity` | Compares api-kt with the saved responses | Same after the README's allowed differences |
| `finish` | Checks that nothing restarted the Node API, and records the finished cutover | Every Node colour is still stopped |

The script then prints the cloudflared command (§4.4).

**What the copy verifies.** The source's column list drives the copy. A table, column
or sequence that only one side has stops the run before it writes anything
(`COPY_CHECK_FAILED schema drift: …`). After the copy:

- **row count**: source vs target, per table;
- **checksum**: SHA-256 over every row in a vendor-neutral canonical form
  (UUIDs as text, JSON with sorted keys and normalised numbers, `text[]` as
  JSON arrays, timestamps as UTC instants, every value length-prefixed), rows
  sorted;
- **sequence**: the last number `recipe_code_seq` handed out, on both sides.

The report ends with `COPY_VERIFY_OK source=POSTGRESQL target=MYSQL tables=15
sequences=1`. Any `MISMATCH` exits non-zero.

**If it stops.** The Node API stays stopped, and PostgreSQL is untouched. The window's
way out is always the same: run `rollback` (§4.5), which restarts the Node API. To
retry instead:

| Stopped at | Do this |
|---|---|
| `preflight` or `save` | Nothing changed. Fix the cause and run it again. |
| `stop` | Find what still serves `:8020` or restarted a colour, then run it again. |
| `copy` | The copy rolled back, and the target is still empty. Fix the cause and run it again. |
| `verify`, `start`, `parity` or `finish` | MySQL holds rows. Run it again with `--replace-target`. |

A retry keeps the responses saved before the Node API stopped. `copy` always refuses
a target that holds rows, and no `cutover` runs while a finished one stands, so
`--replace-target` cannot overwrite live data.

**If `parity` shows only a different order.** PostgreSQL and MySQL may sort
`name` differently (`utf8mb4_0900_as_cs` against the PostgreSQL collation), and
they place a NULL `continuum_position` differently. Decide whether that is
acceptable. To accept it, retry with `--replace-target --accept-order`. It covers only
the order of the rows in `/api/beans`, `/api/grinders` and `/api/drippers`, and of
recipes with an equal `created_at`, which have no defined order on either database.
The script still stops on any other order difference, such as recipe steps or a
recipe list sorted differently, and on any difference in content. It reports each
accepted path.

### 4.4 Switch traffic (desk)

1. Run the command the script printed:
   ```sh
   sudo sed -i 's#http://127.0.0.1:8020#http://127.0.0.1:8021#' /etc/cloudflared/config.yml && sudo systemctl restart cloudflared
   ```
2. Smoke test: run public `/api/health`, `/api/db/health` and a read, then
   one agent write through MCP. Check Sentry.
3. Move the backup timers to HeatWave now (§4.6). PostgreSQL no longer changes,
   and the timers do not cover the live data until you do.
4. Point releases at api-kt: change `deploy-oci.yml` to build `apps/api-kt` and
   move its `production` tag, and change the Dagu job to follow `brewdial-api-kt`.
   Do this in a follow-up PR, after the rollback window closes.

### 4.5 Rollback

One command covers both cases. It uses the digest the cutover ran with:

```sh
sudo /opt/brewdial/deploy/oci/heatwave-phase4.sh rollback --digest sha256:<api-kt digest>
```

It stops api-kt and the Node API, so that nothing runs against either database. Then:

| State | What it does |
|---|---|
| No finished cutover: the window failed or was abandoned | Nothing is copied, because MySQL never served. It starts the Node API on the untouched PostgreSQL |
| A finished cutover, and MySQL still matches PostgreSQL | Nothing is copied, because MySQL took no writes. It starts the Node API |
| A finished cutover, and MySQL differs | It dumps PostgreSQL to `/var/backups/brewdial/final-postgres/pre-rollback-<time>.dump`, replaces every row from MySQL in one transaction, compares before it commits, compares again in a new snapshot, then starts the Node API |

Rows written, changed or deleted on MySQL all arrive, and the sequence continues
where MySQL stopped. Public traffic gets a 503 until this finishes.

Then switch traffic back, with the command it prints, and resume the Dagu jobs:

```sh
sudo sed -i 's#http://127.0.0.1:8021#http://127.0.0.1:8020#' /etc/cloudflared/config.yml && sudo systemctl restart cloudflared
```

If §4.6 already ran, point the backup timers back at PostgreSQL:

```sh
sudo sed -i 's#backup-heatwave.sh#backup.sh#' /etc/systemd/system/brewdial-backup.service
sudo sed -i 's#verify-restore-heatwave.sh#verify-restore.sh#' /etc/systemd/system/brewdial-verify.service
sudo systemctl daemon-reload
```

On failure, PostgreSQL keeps its previous rows and the Node API stays stopped. Read
the tool log the script names: a value PostgreSQL cannot store, such as one that
exceeds a size limit there, is named by its database error. Fix the row on MySQL,
then run `rollback` again. Once a rollback has copied or found no writes, a second one
copies nothing, so it can never overwrite what PostgreSQL takes next.

### 4.6 Backup timers → HeatWave

Do this right after the switch (§4.4 step 4). The timer names and schedules stay. `backup-heatwave.sh` runs `mysqldump --single-transaction` and
`verify-restore-heatwave.sh` restores into a throwaway MySQL container with no
network, then compares every table with the live schema. Both read credentials
from an env-file path and never print them. The clients run from a pinned
`mysql:8.4` image, so the host needs no MySQL package.

1. Create a read-only user on HeatWave, then the env file
   (`deploy/oci/heatwave.env.example`):
   ```sh
   sudo install -m 0600 -o opc -g opc /dev/null /etc/brewdial/heatwave.env
   sudoedit /etc/brewdial/heatwave.env
   sudo grep -c '^DATABASE_URL=mysql://' /etc/brewdial/heatwave.env   # expect 1
   ```
2. Add `HEATWAVE_ENV=/etc/brewdial/heatwave.env` to `/etc/brewdial/backup.env`.
3. Install the units, then run each once:
   ```sh
   sudo install -m 0644 deploy/oci/brewdial-backup.service deploy/oci/brewdial-verify.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl start brewdial-backup.service && journalctl -u brewdial-backup.service -n 5 --no-pager
   sudo systemctl start brewdial-verify.service && journalctl -u brewdial-verify.service -n 5 --no-pager   # GATE PASS
   ls -l /var/backups/brewdial/daily/ | tail -2                       # a new brewdial-*.sql.gz
   systemctl list-timers 'brewdial-*'
   ```
4. Update the Mac's copy of `deploy/mac/pull-backups.sh`. It now accepts
   `*.sql.gz` as well as `*.dump`, and it checks that a dump is complete.

**Restoring a dump on HeatWave.** A dump keeps each trigger's `DEFINER`, and a user
without the privilege to set it gets `ERROR 1227`. Remove the clause on the way in.
The dump names no database, so choose the target:

```sh
gzip -dc brewdial-<time>.sql.gz | sed -E 's/DEFINER=`[^`]+`@`[^`]+`//' | mysql --defaults-extra-file=<option file> <database>
```

### 4.7 PostgreSQL retirement (desk)

Retirement ends the §4.5 rollback, so do it only after the desk closes the window
and §4.6 has run for at least one backup and one verify. api-kt keeps its PostgreSQL support in code.

1. **Final dump** to the existing backup path. `final-postgres/` is outside
   retention, and the Mac pulls it with everything else. It holds the data as
   of the cutover, because nothing has written to PostgreSQL since then. The current
   data is in the HeatWave dumps from §4.6.
   ```sh
   stamp="$(date -u +%Y%m%d-%H%M)"
   sudo install -d -o opc -g opc -m 0750 /var/backups/brewdial/final-postgres
   sudo -u postgres pg_dump -Fc brewdial | sudo -u opc tee "/var/backups/brewdial/final-postgres/brewdial-$stamp.dump" > /dev/null
   sudo -u postgres pg_dumpall --globals-only | sudo -u opc tee "/var/backups/brewdial/final-postgres/globals-$stamp.sql" > /dev/null
   sudo -u opc /opt/brewdial/deploy/oci/verify-restore.sh "/var/backups/brewdial/final-postgres/brewdial-$stamp.dump"   # GATE PASS
   ```
   Do not continue until the Mac's next pull holds the file.
2. **Stop what still uses PostgreSQL.** The Node API stopped in the window. Remove
   any Dagu job that still follows or heals `brewdial-api`, or it restarts a colour.
   Then check that nothing connects:
   ```sql
   select usename, client_addr, count(*) from pg_stat_activity where datname = 'brewdial' group by 1, 2;
   ```
   ```sh
   sudo systemctl disable --now brewdial-api    # the legacy systemd unit, if it is still installed
   sudo systemctl disable --now k3s             # if phase 3 left it enabled
   ```
3. **Stop and disable PostgreSQL.** The API must not notice:
   ```sh
   sudo systemctl disable --now postgresql-17
   ss -ltn | grep -c ':5432 '                   # expect 0
   curl -fsS https://<public host>/api/db/health
   ```
4. **Keep the data directory for 14 days.** Record the date in the change record.
   Find the path with `sudo systemctl cat postgresql-17 | grep PGDATA` (usually
   `/var/lib/pgsql/17/data`). To go back within the 14 days, run `sudo systemctl
   enable --now postgresql-17`, then §4.5 with the digest the cutover ran with. If
   api-kt has migrated its schema since, that image may no longer match MySQL: decide
   by hand, using the HeatWave dumps from §4.6.
5. **Remove, after 14 days** (a later, separate change):
   ```sh
   sudo dnf remove 'postgresql17*'
   sudo rm -rf /var/lib/pgsql/17
   sudo rm -f /etc/shiftgate/brewdial-copy.env /etc/shiftgate/brewdial-rollback.env \
     /etc/shiftgate/brewdial-api.env /etc/brewdial/api.env /var/lib/brewdial/phase4-cutover-done
   ```
   In the repository, delete the
   `brewdial-api` service from `services.yaml`, `apps/api`, `packages/db`,
   `backup.sh` and `verify-restore.sh` in one PR, and keep `final-postgres/`.
