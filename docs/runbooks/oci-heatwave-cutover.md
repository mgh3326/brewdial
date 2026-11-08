# OCI: k3s → shiftgate, 이후 PostgreSQL → HeatWave MySQL (ROB-1435)

OCI 호스트에서 실행 중인 `brewdial-api`를 k3s에서 shiftgate로 옮긴 뒤, Node API가 연결하는 데이터베이스를 PostgreSQL에서 HeatWave MySQL로 전환한다. shiftgate는 digest로 배포한 Docker 컨테이너를 HAProxy 뒤에서 blue-green 방식으로 운영한다. PostgreSQL은 §4.7 정리 시점까지 롤백 대상으로 유지한다. Node API와 `packages/db`도 이 전환 동안 계속 사용한다.

| 단계 | 변경 내용 | 롤백 |
|---|---|---|
| 1. 호스트 준비 | Docker, shiftgate, HAProxy 컨테이너, 환경 파일, 배포 키 설치 | 아직 트래픽을 보내지 않음 |
| 2. k3s → shiftgate 전환 | cloudflared `:30020`에서 PostgreSQL을 사용하는 Node API `:8020`으로 변경 | cloudflared를 `:30020`으로 되돌림 |
| 3. k3s 제거 | `systemctl disable --now k3s`, 이후 관련 파일 제거 | 파일 제거 전에는 `systemctl start k3s` |
| 4. Node API → HeatWave MySQL | 유지보수 창에서 Node API 중지, 복사와 검증 후 MySQL 연결 Node API 시작, 이어서 cloudflared를 `:8021`로 변경 | §4.5에서 복사 필요 여부를 확인하고 PostgreSQL 연결 Node API를 시작한 뒤 `:8020`으로 복귀 |

1–3단계는 함께 수행한다. 4단계는 별도 유지보수 창에서 수행한다.

운영 규칙:

- 명령은 `opc` 계정에서 `sudo`와 함께 실행한다. 명령 출력에 비밀 값이 나타나지 않도록 한다.
- **데이터베이스 자격 증명은 환경 파일 경로로만 전달한다.** 파일은 `/etc/shiftgate/brewdial-api.env`와 `/etc/shiftgate/brewdial-api-mysql.env`이며 소유자는 `root:root`, 권한은 `0600`이다. shiftgate는 파일 내용을 출력하지 않고 `docker run --env-file`에 경로로 전달한다. 파일을 커밋하거나 티켓에 붙이거나 `cat`으로 출력하지 않는다. 키 존재 여부는 `sudo grep -c '^DATABASE_URL=' <file>`로 확인한다.
- 저장소 설정은 `deploy/oci/shiftgate/services.yaml` 및 `.github/workflows/deploy-oci.yml`이다.

---

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

## 4. Node API → HeatWave MySQL

이 단계에서는 현재 PostgreSQL을 사용하는 Node API를 잠시 멈추고 데이터를 HeatWave MySQL로 복사한 뒤, 같은 Node API를 MySQL 연결로 시작한다. 복사 도구만 `ghcr.io/mgh3326/brewdial-api-kt` 이미지에서 가져온다. 이 도구는 롤백 기간이 끝날 때까지 유지한다. 서비스 이미지와 복사 도구 이미지는 서로 다른 digest를 사용한다. 실제 전환은 운영자가 참석한 유지보수 시간에 수행한다.

### 4.1 사전 조건

- **HeatWave.** 사설 서브넷에서 MySQL 8.4 LTS 이상을 사용한다. 호스트 서브넷에서 TCP 3306만 허용한다. `brewdial` 데이터베이스와 애플리케이션 사용자를 만들고 필요한 권한을 부여한다. 트리거 생성 권한과 바이너리 로그 설정을 미리 확인한다.
- **호스트의 스크립트.** `/opt/brewdial`에 `deploy/oci/heatwave-phase4.sh`가 포함된 커밋을 설치한다.
- **서비스 설정.** 이 PR의 `deploy/oci/shiftgate/services.yaml`을 호스트의 `/etc/shiftgate/services.yaml`에 복사한다. 새 서비스는 `brewdial-api-mysql`이다.
- **새 서비스 환경 파일.** `/etc/shiftgate/brewdial-api-mysql.env`를 `0600`으로 만들고 `AGENT_TOKEN`, `SENTRY_DSN`, HeatWave의 `DATABASE_URL=mysql://…`를 넣는다. `DATABASE_URL`은 복사 도구의 대상 URL과 같은 값이어야 한다. 기존 `/etc/shiftgate/brewdial-api.env`에 설정된 `BREWDIAL_MCP_CF_TEAM_DOMAIN`, `BREWDIAL_MCP_CF_AUD`, `BREWDIAL_MCP_ALLOWED_EMAILS` 값도 새 파일에 복사한다. 값은 화면이나 로그에 출력하지 않는다.
- **복사 환경 파일.** `/etc/shiftgate/brewdial-copy.env`를 `0600`으로 만들고 `DATABASE_URL`에는 HeatWave 대상 URL, `BREWDIAL_COPY_SOURCE_URL`에는 PostgreSQL 원본 URL을 둔다. 롤백 파일은 두 URL의 방향을 바꾸어 만든다. 비밀 값을 터미널이나 명령 인수에 출력하지 않는다.

  ```sh
  sudo sh -c 'umask 077; while IFS= read -r line; do case "$line" in DATABASE_URL=*) printf "BREWDIAL_COPY_SOURCE_URL=%s\n" "${line#DATABASE_URL=}" ;; BREWDIAL_COPY_SOURCE_URL=*) printf "DATABASE_URL=%s\n" "${line#BREWDIAL_COPY_SOURCE_URL=}" ;; esac; done < /etc/shiftgate/brewdial-copy.env > /etc/shiftgate/brewdial-rollback.env'
  sudo grep -cE '^(DATABASE_URL=postgres|BREWDIAL_COPY_SOURCE_URL=mysql)' /etc/shiftgate/brewdial-rollback.env   # expect 2
  ```

- **PostgreSQL 사전 조건.** 프로덕션 데이터베이스의 적용된 마이그레이션과 대상 스키마를 확인한다. 복사 도구는 지원하지 않는 스키마 차이, 범위 초과 값, 충돌하는 고유 키가 있으면 쓰기 전에 중단한다.
- **쓰기 중단.** 유지보수 창이 끝나고 롤백 기간이 닫힐 때까지 `shiftgate follow` 또는 `shiftgate check --heal`을 실행하는 Dagu 작업을 멈춘다. PostgreSQL에 쓰는 수동 로더도 실행하지 않는다.
- **사용자 공지.** Node API를 멈춘 시점부터 트래픽 전환이 끝날 때까지 API 요청은 실패할 수 있다. 읽기와 쓰기가 모두 중단되는 시간을 미리 공지한다.

### 4.2 사전 동등성 확인

1. **CI 계약 테스트.** Node API의 PostgreSQL 및 MySQL API 작업이 현재 커밋에서 통과했는지 확인한다. MySQL 이미지 작업은 서비스 명령으로 마이그레이션을 두 번 실행하고 `/api/db/health`가 200을 반환하는지도 확인한다.
2. **라우트 및 데이터 동등성.** 같은 Node 코드가 두 데이터베이스에서 동작하므로 런타임 간 라우트 차이를 비교하지 않는다. 변경된 데이터베이스 경로에 대한 테스트와 CI 결과를 확인한다.
3. **응답 사전 비교.** 스크립트가 중단 전에 저장하는 Node-on-PostgreSQL 응답을 Node-on-MySQL 응답과 비교한다. JSON의 날짜 문자열은 MySQL `DATETIME(6)`의 마이크로초와 PostgreSQL의 밀리초 차이 때문에 밀리초 UTC 표기로 정규화한다. 이 정규화는 날짜 문자열에만 적용되며 숫자로 보이는 문자열이나 다른 값은 바꾸지 않는다.

### 4.3 유지보수 창: 중지, 복사, 검증, 시작

먼저 새 환경 파일과 서비스 설정을 호스트에 설치한 뒤, 두 digest를 사용해 읽기 전용 사전 점검을 수행한다.

```sh
sudo /opt/brewdial/deploy/oci/heatwave-phase4.sh cutover --digest sha256:<Node 이미지 digest> --copy-digest sha256:<복사 도구 이미지 digest> --preflight
```

점검이 통과하면 유지보수 창에서 다음 명령을 실행한다.

```sh
sudo /opt/brewdial/deploy/oci/heatwave-phase4.sh cutover --digest sha256:<Node 이미지 digest> --copy-digest sha256:<복사 도구 이미지 digest>
```

스크립트는 첫 실패 지점에서 중단한다. 도구 로그는 `/var/log/brewdial-phase4/`에 저장되고 출력의 연결 자격 증명은 마스킹된다.

| 단계 | 수행 작업 | 통과 조건 |
|---|---|---|
| `preflight` | 파일 권한과 키, shiftgate 상태, 건강 상태를 확인 | 환경 파일이 `0600`, URL이 올바르고 기존 Node 서비스와 새 서비스 상태가 점검됨 |
| `save` | PostgreSQL을 사용하는 Node API의 읽기 응답 저장 | 모든 대상 경로가 응답함 |
| `stop` | 두 Node 서비스의 모든 색상을 중지 | PostgreSQL 서비스와 MySQL 서비스가 중지되고 `:8020` 응답이 사라짐 |
| `copy` | PostgreSQL 데이터를 MySQL로 복사하고 행 수, 체크섬, 시퀀스 확인 | `COPY_VERIFY_OK` 및 종료 코드 0 |
| `verify` | 새 스냅샷에서 양쪽 데이터베이스 재비교 | `COPY_VERIFY_OK` |
| `start` | `brewdial-api-mysql`을 Node 이미지 digest로 배포 | 해당 digest가 활성 상태이고 `:8021/api/db/health`가 200 |
| `parity` | 저장된 PostgreSQL 응답과 MySQL 응답 비교 | 날짜 정규화 후 내용이 같음. `--accept-order`는 명시된 목록 순서 차이만 허용 |
| `finish` | 기존 PostgreSQL 서비스를 계속 중지 상태로 확인 | 모든 기존 Node 색상이 중지되어 있음 |

복사 결과에는 테이블별 행 수와 체크섬, `recipe_code_seq` 값이 포함된다. 스키마가 다르거나 어느 검증이라도 실패하면 `PHASE4_FAILED step=<단계>`와 함께 종료한다. 실패 후에는 PostgreSQL을 다시 시작하기 전까지 쓰기가 없어야 한다.

`verify`, `start`, `parity` 또는 `finish` 단계에서 실패하여 MySQL에 데이터가 남았으면 재시도 시 `--replace-target`을 추가한다. 완료 마커가 있는 경우에는 새 복사를 시작하지 말고 먼저 롤백한다. 저장 응답은 기존 Node API를 다시 시작해 저장물을 새로 만들지 않는 한 재시도에 재사용된다.

`--accept-order`는 이름의 데이터베이스 정렬 차이나 NULL 위치 차이에 따른 `/api/beans`, `/api/grinders`, `/api/drippers` 최상위 목록 순서, 그리고 `created_at`이 같은 레시피 행의 순서만 허용한다. 배열 안의 순서, 레시피 단계 순서, 값의 차이는 계속 실패한다.

### 4.4 트래픽 전환

스크립트가 출력하는 명령은 Cloudflared 설정의 모든 `8020` 경로를 `8021`로 바꾼다. 유지보수 창 담당자가 실행한다.

```sh
sudo sed -i -e 's#http://127.0.0.1:8020#http://127.0.0.1:8021#g' -e 's#http://localhost:8020#http://localhost:8021#g' /etc/cloudflared/config.yml && sudo systemctl restart cloudflared
```

공개 API의 상태 및 데이터베이스 건강 경로와 읽기 요청을 확인하고, MCP를 통한 쓰기도 확인한다. 오류 감시를 확인한 뒤 백업 타이머를 HeatWave에 맞게 전환한다. 롤백 기간 동안에는 PostgreSQL을 삭제하거나 기존 서비스 이미지를 제거하지 않는다.

### 4.5 롤백

롤백에는 cutover에 사용한 Node 이미지와 복사 도구의 digest를 모두 전달한다.

```sh
sudo /opt/brewdial/deploy/oci/heatwave-phase4.sh rollback --digest sha256:<Node 이미지 digest> --copy-digest sha256:<복사 도구 이미지 digest>
```

스크립트는 MySQL의 Node 서비스와 기존 PostgreSQL의 Node 서비스를 중지한다. 완료 마커가 없으면 MySQL이 트래픽을 받지 않았으므로 PostgreSQL을 복사하지 않고 기존 서비스를 시작한다. 완료 마커가 있고 MySQL에 쓰기가 없으면 데이터 복사 없이 PostgreSQL의 Node 서비스를 시작한다. MySQL에 쓰기가 있으면 안전 덤프를 만든 다음 MySQL 데이터를 PostgreSQL에 복사하고 양쪽을 검증한 뒤 기존 서비스를 시작한다.

그 다음 Cloudflared 설정의 모든 `8021` 경로를 `8020`으로 돌린다.

```sh
sudo sed -i -e 's#http://127.0.0.1:8021#http://127.0.0.1:8020#g' -e 's#http://localhost:8021#http://localhost:8020#g' /etc/cloudflared/config.yml && sudo systemctl restart cloudflared
```

역방향 복사 또는 그 뒤의 검증이 실패하면 PostgreSQL이 이미 일부 또는 전부 바뀌었을 수 있다. 기존 Node 서비스는 시작하지 않는다. 로그를 확인하고 롤백 전에 만든 `pre-rollback-*.dump`를 PostgreSQL에 복원한 뒤, 동일한 두 digest로 롤백을 다시 실행한다. 백업 타이머도 전환했다면 PostgreSQL용 스크립트로 되돌린다.

### 4.6 HeatWave 백업 타이머

트래픽 전환 후 HeatWave 전용 백업 및 복구 검증 스크립트를 설정한다. 기존 타이머 일정은 유지한다. 읽기 전용 DB 사용자의 URL은 `/etc/brewdial/heatwave.env`에 저장하고 권한을 `0600`으로 설정한다. 백업과 검증을 각각 한 번 실행하고 성공 로그와 새 백업 파일을 확인한다. Mac 백업 가져오기 작업도 `.sql.gz` 형식을 지원하는 버전으로 갱신한다.

### 4.7 PostgreSQL 정리

롤백 기간이 끝나고 HeatWave 백업과 복구 검증이 성공한 뒤 별도 운영 작업으로 PostgreSQL을 정리한다. 마지막 PostgreSQL 덤프를 기존 보관 위치에 저장한다. PostgreSQL 지원 코드와 복사 도구는 이 PR에서 제거하지 않는다.
