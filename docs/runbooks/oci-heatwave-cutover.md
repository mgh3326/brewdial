# OCI: k3s → shiftgate, 이후 PostgreSQL → HeatWave MySQL (ROB-1435)

현재 프로덕션은 shiftgate 뒤에서 실행되는 HeatWave MySQL 연결 Node API `brewdial-api-mysql` (`:8021`)이다. Dagu는 `production` 태그를 따라 배포한다. 이 문서는 k3s에서 shiftgate로, PostgreSQL에서 HeatWave MySQL로 전환한 이력을 기록한다. PostgreSQL은 중지 및 비활성화되어 더 이상 롤백 대상으로 사용할 수 없다. Node API와 `packages/db`는 계속 사용한다.

| 단계 | 변경 내용 | 롤백 |
|---|---|---|
| 1. 호스트 준비 | Docker, shiftgate, HAProxy 컨테이너, 환경 파일, 배포 키 설치 | 트래픽 전환 전 |
| 2. k3s → shiftgate 전환 | cloudflared `:30020`에서 PostgreSQL 연결 Node API `:8020`으로 변경 | 완료 당시 k3s가 남아 있었음. 현재는 은퇴하여 사용 불가 |
| 3. k3s 제거 | `systemctl disable --now k3s`, 이후 관련 파일 제거 | k3s 은퇴 후 복구 대상으로 사용 불가 |
| 4. Node API → HeatWave MySQL | Node API 중지, 복사와 검증 후 MySQL 연결 Node API 시작, cloudflared를 `:8021`로 변경 | §4.5의 역사적 절차. PostgreSQL 은퇴 후 사용 불가 |

1–3단계 및 4단계 전환은 완료되었다. 아래 절은 당시 절차와 결과를 위한 운영 기록이다.

운영 규칙:

- 명령은 `opc` 계정에서 `sudo`와 함께 실행한다. 명령 출력에 비밀 값이 나타나지 않도록 한다.
- **데이터베이스 자격 증명은 환경 파일 경로로만 전달한다.** 파일은 `/etc/shiftgate/brewdial-api.env`와 `/etc/shiftgate/brewdial-api-mysql.env`이며 소유자는 `root:root`, 권한은 `0600`이다. shiftgate는 파일 내용을 출력하지 않고 `docker run --env-file`에 경로로 전달한다. 파일을 커밋하거나 티켓에 붙이거나 `cat`으로 출력하지 않는다. 키 존재 여부는 `sudo grep -c '^DATABASE_URL=' <file>`로 확인한다.
- 저장소 설정은 `deploy/oci/shiftgate/services.yaml` 및 `.github/workflows/deploy-oci.yml`이다.

---

---

## 1. 호스트 준비

1. **Docker.** k3s는 자체 containerd를 제공하므로 Docker를 별도로 설치한다.
   Oracle Linux 9 (aarch64)용 `docker-ce`를 설치하고 `sudo systemctl
   enable --now docker`를 실행한다.
2. **shiftgate.** 고정된 revision에서 linux/arm64 바이너리를 빌드한다.
   (`.github/workflows/shiftgate-render.yml`은 렌더링 전용 revision을 고정한다. 호스트에는 `follow`가 추가된 revision이 필요하다.)
   ```sh
   git clone https://github.com/mgh3326/shiftgate && cd shiftgate && git checkout d0cc564   # first revision with `shiftgate follow`
   CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o shiftgate ./cmd/shiftgate
   # Copy the binary to the host if you built it elsewhere, then on the host:
   sudo install -m 0755 shiftgate /usr/local/bin/shiftgate
   ```
3. **설정.** 저장소의 파일을 설치한다:
   ```sh
   sudo install -d -m 0755 /etc/shiftgate /etc/shiftgate/haproxy /var/lib/shiftgate /run/shiftgate-haproxy
   sudo install -m 0644 deploy/oci/shiftgate/services.yaml /etc/shiftgate/services.yaml
   ```
   재부팅 후에도 `/run/shiftgate-haproxy`를 유지하려면 `tmpfiles.d` 항목
   `d /run/shiftgate-haproxy 0755 99 99 -`을 추가한다. 공식 이미지에서 uid 99는
   `haproxy` 사용자다.
4. **HAProxy 컨테이너.** Oracle Linux 9에는 HAProxy 2.4가 포함되며 shiftgate에는
   2.8 이상이 필요하다. `shiftgate-haproxy.service`라는 systemd unit에서 고정된
   공식 이미지를 host network로 실행한다:
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
   시작 전에 한 번 렌더링한다. 각 색상은 비활성 상태로 시작한다.
   ```sh
   sudo shiftgate render --no-reload        # validates with haproxy -c, writes the file
   sudo systemctl enable --now shiftgate-haproxy
   sudo shiftgate status
   ```
5. **`brewdial-api` 환경 파일 (Node API, PostgreSQL).** 값을 출력하지 않고
   `/etc/brewdial/api.env`에서 키를 복사한다:
   ```sh
   sudo install -m 0600 -o root -g root /dev/null /etc/shiftgate/brewdial-api.env
   sudo sh -c 'grep -E "^(DATABASE_URL|AGENT_TOKEN|SENTRY_DSN)=" /etc/brewdial/api.env > /etc/shiftgate/brewdial-api.env'
   sudo grep -c '^DATABASE_URL=postgres://' /etc/shiftgate/brewdial-api.env   # expect 1
   ```
   컨테이너는 host networking을 사용하므로 `DATABASE_URL`에는 k3s bridge IP
   `10.42.0.1`이 아니라 `127.0.0.1`을 사용한다. `PORT`, `HOST`, `GIT_SHA`는 파일에
   넣지 않는다. shiftgate가 색상 포트로 `PORT`를 설정하고, services.yaml이 `HOST`를
   설정하며, 이미지에 `GIT_SHA`가 포함된다.
6. **레지스트리 로그인.** GHCR 패키지가 비공개라면 shiftgate 실행 사용자로 한 번
   로그인한다. `read:packages` 권한만 있는 토큰을 사용한다.
7. **Pull 방식 배포 (CI에서 호스트에 접근하지 않음).** CI는 이미지를 빌드 및 푸시하고
   릴리스 시 `production` 태그를 이동한다. 호스트가 해당 태그를 따라간다. 이 호스트의
   Dagu는 몇 분마다 다음 명령을 실행한다:
   `sudo shiftgate follow brewdial-api --tag production`. 배포 사용자, SSH key,
   tailnet OAuth client 또는 저장소 secret은 필요하지 않다. 이미지는 공개 GHCR
   패키지다. 비공개로 바뀌면 호스트에서 `read:packages` 토큰으로 한 번 로그인한다.

## 2. 전환: k3s → shiftgate (Node API, PostgreSQL)

k3s는 전환 중 `127.0.0.1:30020`에서 계속 요청을 처리한다. shiftgate는
`127.0.0.1:8020`에서 요청을 처리한다. 전환은 cloudflared ingress 설정으로 수행한다.

1. **첫 배포 (CI 또는 수동).** 현재 k3s가 제공하는 digest를 사용해 runtime만
   변경한다:
   ```sh
   kubectl -n brewdial get deploy brewdial-api -o jsonpath='{.spec.template.spec.containers[0].image}'   # …@sha256:<digest>
   sudo shiftgate deploy brewdial-api --digest sha256:<digest>
   sudo shiftgate status
   curl -fsS http://127.0.0.1:8020/api/health && curl -fsS http://127.0.0.1:8020/api/db/health
   ```
   컨테이너는 k3s initContainer와 같이 서버 시작 전 `node-pg-migrate up`을 실행한다.
   `pgmigrations`에 모든 마이그레이션이 기록되어 있으므로 당시 데이터베이스에서는
   변경이 없었다.
2. **CI 릴리스.** 배포할 `main` commit으로 `production`을 fast-forward 한다
   (`git push origin main:production`). workflow가 빌드 및 푸시한 뒤 해당 digest로
   `ghcr.io/mgh3326/brewdial:production` 태그를 이동한다. 몇 분 내 호스트 follower가
   유휴 색상에 배포하며 `shiftgate rollback`도 사용할 수 있게 된다. 새 digest는
   `shiftgate status`에서 확인한다. 롤백한 digest는 새 태그가 지정될 때까지 follower가
   유지한다.
3. **트래픽 전환.** `/etc/cloudflared/config.yml`에서 ingress를
   `http://127.0.0.1:30020`에서 `http://127.0.0.1:8020`으로 변경한다. 이어서
   `sudo systemctl restart cloudflared`를 실행하고 공개 `/api/health` 및
   `/api/db/health`를 확인한다.
4. **하루 동안 관찰.** `shiftgate status`, `docker logs
   shiftgate-brewdial-api-<colour>` 출력 및 Sentry를 확인한다.

**롤백 (2단계, 현재 사용 불가):** 당시에는 cloudflared를
`http://127.0.0.1:30020`으로 되돌리고 재시작했다. k3s가 계속 실행 중이었으며 두
runtime이 같은 PostgreSQL을 사용해 데이터 이동은 없었다. shiftgate 이미지 문제에는
`sudo shiftgate rollback brewdial-api`를 실행했다. 이전 색상을 시작하고 상태 확인 후
HAProxy를 전환하는 절차다. k3s와 PostgreSQL이 은퇴한 현재는 이 롤백을 사용할 수 없다.

## 3. k3s 제거 (desk)

2단계가 관찰 기간 동안 안정적으로 동작한 뒤 수행하는 절차였다.

1. 복구 가능성을 유지하도록 파일을 남긴 채 k3s를 중지한다:
   ```sh
   sudo systemctl disable --now k3s
   sudo /usr/local/bin/k3s-killall.sh      # stops leftover pods and containerd shims; keeps /var/lib/rancher
   free -m                                  # expect about 800 MB back
   ```
2. **다음 4단계 작업이 끝날 때까지 롤백을 위해 보존할 항목:**
   - `/etc/rancher/k3s/` (kubeconfig, registries) and `/var/lib/rancher/k3s/`
     (cluster state and images);
   - `deploy/oci/k3s/` and `.github/workflows/deploy-oci-k3s.yml` in the
     repository (manual dispatch only, marked deprecated);
   - the host PostgreSQL listener on the bridge IP `10.42.0.1` and its
     pod-CIDR `pg_hba` line.

   당시 k3s 복구 방법은 `sudo systemctl enable --now k3s`로 시작하고 pod 준비 후
   cloudflared를 `:30020`으로 되돌리는 것이었다. k3s 은퇴 후에는 사용할 수 없다.
3. **최종 제거** (후속 별도 변경): 다음을 실행한다:
   `/usr/local/bin/k3s-uninstall.sh`. Then delete `deploy/oci/k3s/`,
   `deploy-oci-k3s.yml` and the k3d `k8s-validate.yml` job in one PR. Also
   remove the `10.42.0.1` PostgreSQL listener and its `pg_hba` line.

## 4. Node API → HeatWave MySQL

이 단계에서는 현재 PostgreSQL을 사용하는 Node API를 잠시 멈추고 데이터를 HeatWave MySQL로 복사한 뒤, 같은 Node API를 MySQL 연결로 시작한다. 복사 도구만 `ghcr.io/mgh3326/brewdial-api-kt` 이미지에서 가져온다. 이 도구는 롤백 기간이 끝날 때까지 유지한다. 서비스 이미지와 복사 도구 이미지는 서로 다른 digest를 사용한다. 실제 전환은 운영자가 참석한 유지보수 시간에 수행한다.

### 4.0 2026-11-09 — 4단계 완료 기록

4단계 전환이 완료되었다. 첫 실행은 `/api/beans`의 순서만 달랐다. 레시피가 없는 원두 목록의 이름 정렬에서 데이터베이스 collation 차이가 있었으며, `--accept-order` 옵션으로 다시 실행했다.

`start` 단계가 실행된 뒤 `--replace-target`을 사용한 재시도는 `copy`에서 실패했다. 대상의 Node MySQL 마이그레이션 테이블 `schema_migrations`가 복사 도구의 테이블 목록에 포함되지 않았기 때문이다. 대상 데이터베이스를 비운 뒤 다시 실행하는 방식으로 해결했다.

`finish` 단계는 마커 디렉터리 `/var/lib/brewdial`이 없어 실패했고, 마커를 수동으로 기록했다. 또한 `sudo`의 `secure_path`에 `/usr/local/bin`이 없어 `shiftgate`를 찾지 못했다. `sudo env PATH=/usr/local/bin:…` 형태로 스크립트를 실행했다.

전환 후 백업 및 검증 타이머는 HeatWave 스크립트를 실행한다. 저장소의 unit 파일은 이미 이를 가리키고 있었으며 호스트에는 이전 unit 파일이 설치되어 있었다. Mac pull 스크립트를 갱신했고, Dagu follow/check 작업은 `brewdial-api-mysql`을 대상으로 하도록 변경했다. `production`을 `main`에서 릴리스했다. PostgreSQL은 마지막 덤프 후 중지 및 비활성화했으며 데이터 디렉터리는 보존했다. PostgreSQL은 더 이상 롤백 대상이 아니다.

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

**이 절차는 과거 기록이며 현재는 사용할 수 없다.** PostgreSQL은 최종 덤프 후 중지 및 비활성화되었고, 더 이상 롤백 대상으로 운영되지 않는다.

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

마지막 PostgreSQL 덤프를 보관한 뒤 PostgreSQL 서비스를 중지하고 비활성화했다. 데이터 디렉터리는 보존 중이며, 실제 제거는 운영자 결정이 남아 있다. PostgreSQL 지원 코드와 복사 도구는 이 문서 변경에서 제거하지 않는다.
