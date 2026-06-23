# M1 — OCI 프로비저닝 런북 (Postgres + 백엔드 호스트, Docker 없이)

> **성격:** 이건 TDD 코드 플랜이 아니라 **운영 런북**(대부분 사용자가 OCI 콘솔/SSH에서 수행). Linear: ROB-619. M2~M5는 로컬 PG로 개발하므로 M1에 막히지 않지만, **M6 컷오버(실배포) 전에 완료** 필요.

**목표:** OCI 인스턴스(2 OCPU/12GB, Ampere A1/aarch64)에 **네이티브 PostgreSQL ≥15 + Node 22 백엔드**를 올리고, DB는 외부 미노출(127.0.0.1), 백엔드는 **Cloudflare Tunnel** 뒤에 둔다. **Docker 미사용**(시스템 패키지 + systemd).

**전제:** OCI 계정 + 인스턴스 1대(Ampere A1, Ubuntu 22.04/24.04 LTS 권장; Oracle Linux 9면 `apt`→`dnf`로 치환). Cloudflare 계정 + 도메인(이미 CF 사용 중).

---

## 리포에 들어가는 산출물 (지금/이후 커밋 가능)
프로비저닝 자체는 외부 ops지만, 아래 템플릿은 `deploy/oci/`로 리포에 커밋한다(M5/M6에서 사용):
- `deploy/oci/brewdial-api.service` — systemd 유닛(아래 §4)
- `deploy/oci/brewdial-api.env.example` — env 템플릿(시크릿 값 없이 키만)
- `deploy/oci/cloudflared-config.example.yml` — Tunnel ingress 샘플
- `deploy/oci/backup.sh` — pg_dump → Object Storage 스크립트
- `deploy/oci/README.md` — 이 런북 요약 + 복구 절차

> 실제 시크릿(DB 비밀번호, 토큰, 인증서)은 **레포에 절대 커밋 금지** — 박스의 `EnvironmentFile`(권한 600)에만.

---

## 1. 인스턴스 + OS 기본
- [ ] OCI 콘솔에서 Ampere A1 인스턴스 생성(2 OCPU/12GB, Ubuntu LTS, 부팅 볼륨 충분히). SSH 키 등록.
- [ ] `sudo apt update && sudo apt -y upgrade`
- [ ] 시간대/로케일(UTF-8) 확인: `locale` → `en_US.UTF-8` 또는 `C.UTF-8`.
- [ ] 방화벽 기본: OCI **보안 리스트/NSG에서 5432 인바운드 없음** 확인(있으면 제거). 인스턴스 `ufw`로도 5432 차단(아래 §5).

## 2. PostgreSQL ≥15 (네이티브)
- [ ] 설치: `sudo apt -y install postgresql postgresql-contrib` (Ubuntu 24.04 = PG16; 22.04는 PGDG 저장소로 15+ 확보). **버전 확인** `psql --version` ≥ 15.
- [ ] 클러스터 기동 확인: `sudo systemctl enable --now postgresql`.
- [ ] DB/롤 생성:
```bash
sudo -u postgres psql <<'SQL'
create role brewdial_app login password '<APP_DB_PASSWORD>';   -- 런타임(최소권한)
create database brewdial owner brewdial_app;
\c brewdial
create extension if not exists pgcrypto;
SQL
```
- [ ] **최소권한:** 마이그레이션(DDL)은 별도 1회성 롤 또는 `postgres`로 적용하고, 런타임 `brewdial_app`은 DML만(필요 시 마이그레이션 후 `revoke create on schema public from brewdial_app`). 슈퍼유저로 앱을 돌리지 않는다.
- [ ] **사전점검(M6 게이트):** `select version()` ≥15 / `create extension pgcrypto` 성공 / `bean_summaries` 뷰가 `security_invoker` 유지(PG≥15).

## 3. 네트워크 잠금 — DB는 절대 외부 미노출
- [ ] `postgresql.conf`: `listen_addresses = 'localhost'` (127.0.0.1만). 재시작.
- [ ] `pg_hba.conf`: localhost `scram-sha-256`만, 외부 host 라인 없음.
- [ ] `ufw`: `sudo ufw default deny incoming; sudo ufw allow 22; sudo ufw enable` — **5432는 허용하지 않음**.
- [ ] **검증:** 외부 호스트에서 `nc -vz <OCI_PUBLIC_IP> 5432` → **거부/타임아웃**이어야 함(통과하면 잠금 실패).

## 4. 백엔드 런타임 (Node 22 + systemd, Docker 없이)
- [ ] Node 22 설치(nvm 또는 NodeSource aarch64), `corepack enable && corepack prepare pnpm@10.33.2 --activate`.
- [ ] 배포 디렉토리(예: `/opt/brewdial`)에 빌드 산출물 배치(M5/M6에서 CI 또는 수동). `pnpm --filter @brewdial/api build`.
- [ ] systemd 유닛 `deploy/oci/brewdial-api.service`:
```ini
[Unit]
Description=BrewDial API
After=network.target postgresql.service
[Service]
Type=simple
WorkingDirectory=/opt/brewdial/apps/api
EnvironmentFile=/etc/brewdial/api.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
User=brewdial
[Install]
WantedBy=multi-user.target
```
- [ ] 시크릿: `/etc/brewdial/api.env` (권한 600, 소유 brewdial). 키: `DATABASE_URL=postgres://brewdial_app:<APP_DB_PASSWORD>@127.0.0.1:5432/brewdial`, `PORT=3020`, `SENTRY_DSN=...`, (Spec2) `TOSS_CLIENT_SECRET`, mTLS 인증서 경로 등. **레포 밖.**
- [ ] `sudo systemctl enable --now brewdial-api` → `curl localhost:3020/api/health`/`/api/db/health` green.

## 5. Cloudflare Tunnel (오리진 은닉)
- [ ] `cloudflared` 설치(aarch64), `cloudflared tunnel login` → `cloudflared tunnel create brewdial`.
- [ ] `deploy/oci/cloudflared-config.example.yml`:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: api.brewdial.<your-domain>   # 또는 web과 동일 도메인 /api 프록시(M5에서 CF Worker)
    service: http://127.0.0.1:3020
  - service: http_status:404
```
- [ ] DNS: CF에 위 hostname → Tunnel CNAME. `sudo systemctl enable --now cloudflared`.
- [ ] **검증:** 인스턴스 공개 IP로 80/443 직접 접근이 백엔드에 닿지 않아야 함(닿으면 CF만 통과하도록 OCI 보안리스트에서 80/443 직접 인바운드 제거; cloudflared는 아웃바운드 연결이라 인바운드 불필요).

## 6. 백업 + 복구 (M6 삭제 게이트의 핵심)
- [ ] `deploy/oci/backup.sh`: `pg_dump -Fc brewdial > /var/backups/brewdial/$(date +%F-%H%M).dump` → OCI Object Storage 업로드(`oci os object put` 또는 rclone). 보존(예: 일 7 / 주 4).
- [ ] cron: 일 1회 이상. 로그.
- [ ] **복구 검증(필수):** 스로어웨이 인스턴스/DB에 최신 덤프를 **실제 복원**(`pg_restore`)해 행수 일치 확인. "파일 존재"만으론 불충분.
- [ ] **M6 게이트:** Supabase 삭제 전 (a) OCI 복원 검증 통과, (b) 사전 체크섬 diff 통과.

## 7. 관측성
- [ ] 백엔드 Sentry DSN 설정(release/environment=`oci-prod`). health 엔드포인트를 CF Health Check 또는 uptime 모니터에 연결.
- [ ] 로그: 토큰/DB자격/raw external_key **로깅 금지**(앱 logger 레다크션 + 시스템 로그 권한).

---

## 사전점검 체크리스트 (M6 컷오버 진입 전)
- [ ] `psql --version` ≥ 15, `pgcrypto` 생성됨
- [ ] 외부에서 5432 **도달 불가** (`nc -vz` 거부)
- [ ] 백엔드 `/api/health`·`/api/db/health` green (Tunnel 경유)
- [ ] OCI 공개 IP로 백엔드/DB 직접 접근 불가(오직 CF 경유)
- [ ] 백업 cron 동작 + **복원 검증 1회 완료**
- [ ] 시크릿은 `/etc/brewdial/*.env`(600)에만, 레포에 없음

## 열린 항목
- OCI 리전/도메인/인증서 발급 세부, 백업 보존 수치, 모니터링 대상 — 사용자 운영 판단.
- (Spec 2) 토스 mTLS 클라이언트 인증서 발급/배치 — v2 시점.
