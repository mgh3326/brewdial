# OCI 배포 (M1) — BrewDial 백엔드

OCI 프로덕션 백엔드는 shiftgate 뒤에서 실행되는 Node API이며 HeatWave MySQL에 연결한다. 전체 전환 기록은 `docs/runbooks/oci-heatwave-cutover.md`를 참고한다.

## 현재 프로덕션

- Node API 서비스: `brewdial-api-mysql`, `127.0.0.1:8021`.
- 배포: Dagu가 `production` 태그를 따라 새 이미지를 배포한다. CI에서 `main`을 빌드하고, 릴리스 시 `production` 태그를 이동한다.
- shiftgate는 Docker 컨테이너를 HAProxy 뒤에서 blue-green 방식으로 운영한다. 외부 요청은 cloudflared를 통해 전달된다.
- HeatWave 백업 및 복구 검증 타이머와 Mac pull 작업이 운영 중이다.

## 은퇴한 환경: k3s 및 PostgreSQL

k3s와 PostgreSQL은 프로덕션에서 은퇴했다. PostgreSQL은 마지막 덤프 후 중지 및 비활성화되었으며 데이터 디렉터리는 운영자 결정에 따른 제거 전까지 보존한다. 아래 저장소 경로와 도구는 이전 환경을 위한 역사적 운영 자료다.

### 이전 OCI 호스트 및 systemd 구성

이전 구성은 Oracle Linux 9.7 (aarch64), Node 24 및 pnpm 10.33.2를 사용했다. `/opt/brewdial`의 백엔드와 `brewdial-api.service`는 `/etc/brewdial/api.env`를 사용해 `127.0.0.1:3020`에 바인딩했다. PostgreSQL 17은 로컬에서만 수신했고, cloudflared가 외부 요청을 전달했다. 이 systemd 서비스는 현재 프로덕션 경로가 아니다.

### 배포 이력

`deploy-oci.yml`은 이미지를 GHCR에 빌드 및 게시한다. 릴리스는 `main`을 `production`으로 fast-forward 하여 수행한다:

```sh
git push origin main:production
```

Dagu는 `production` 태그를 감시하고 `brewdial-api-mysql`을 배포한다. 서비스 상태와 완료된 전환 절차는 `docs/runbooks/oci-heatwave-cutover.md`를 참고한다.

- `k3s/`와 `.github/workflows/deploy-oci-k3s.yml`: deprecated k3s 배포 및 복구 자료.
- PostgreSQL용 systemd, 백업 및 마이그레이션 스크립트: 이전 환경 지원용.
- `heatwave-phase4.sh`: 완료된 전환을 위한 절차 스크립트이며, 향후 실행 작업이 아니다.
