# BrewDial v2 — 미니앱 토스 로그인 인증 코어 (설계)

- **작성일:** 2026-06-23
- **결정:** A안 (웹 동기화 보류 · 미니앱 인증 우선)
- **Linear:** 에픽 ROB-613 / ROB-614(파트너 서버+mTLS) · ROB-615(미니앱 appLogin) · ROB-617(병합+인증 RLS) — **v2 범위**. ROB-616(웹 토스 로그인) — **보류(계약 게이트)**.
- **관련 메모리:** `brewdial-identity-schema`, `appintoss-port`
- **검증:** 본 스펙의 스키마 주장은 `supabase/schema.sql` 대조로 검증됨(라인 인용). 적대적 보안 리뷰 1회 반영(2026-06-23).

---

## 0. 요약

v1은 **spoof 가능한 익명 식별**로 출시됨 (미니앱 `toss_anon` = getAnonymousKey 해시, 웹 `web_local` = localStorage UUID). v2는 **토스 미니앱에 진짜 인증(토스 로그인)** 을 도입해 (a) 로그인 사용자의 컬렉션을 인증 신원에 묶고, (b) 권한 판정을 spoof 키가 아닌 검증된 신원 기준으로 올린다.

**핵심 결정 (A안):** 웹 토스 로그인(ROB-616)은 v2에서 제외한다. 이유: (1) `appLogin`은 **토스 앱 전용** — standalone 웹에 네이티브 브리지 없음; (2) 자체 웹 토스 로그인은 **토스 인증부서 별도 계약 필요**(통제 불가 외부 블로커); (3) TDS 비-토스 도메인 차단 선례(PR #31)상 로그인 SDK도 차단 가능성 + shim 불가.

**독립 출시 단위:** v2 *코어* = ROB-614 + 615 + 617 **합쳐서** 하나의 출시 단위. 웹 로그인(616) 없이 독립 출시 가능하나, 코어 내부 3개는 **순차 의존**(614→615→617)이며 인증 경험은 617 완료 시점에 완성된다(개별 티켓이 따로 출시 가능한 게 아님).

> **⛔ 두 개의 ship-blocking 결정 (적대적 리뷰 반영):**
> 1. **인증 세션은 GoTrue 관리 유저를 기본으로** 한다 (custom-JWT 아님). §6.3.
> 2. **로그인 사용자에게는 legacy spoofable write RPC 경로를 닫는다** (`authenticated` grant 회수). "add-only"가 아니라 **회수가 필요한 churn**이다. §4.3 / §6.6.

---

## 1. 배경 & 현재 상태 (v1, PR #33 머지 완료)

- **표면 2개:** 토스 미니앱(React WebView, `@apps-in-toss/web-framework`), 웹(coffee.robinco.dev, Cloudflare Worker). 백엔드 Supabase(Postgres + RLS + SECURITY DEFINER RPC).
- **신원:** `apps/miniapp/src/lib/identity.ts`의 `resolveIdentity()`(memoized singleton, 타입 `'toss_anon'|'web_local'`, localStorage 키 `brewdial.identity`)가 토스 환경이면 `toss_anon`(getAnonymousKey 해시), 아니면 `web_local`(UUID) 반환. 둘 다 **spoofable, 인증 아님** (`schema.sql` 주석 line 727/378에 명시).
- **데이터 접근:** 개인화/신원 테이블은 **RLS deny-all** — anon/authenticated 직접 접근 정책 0개, 오직 SECURITY DEFINER `rpc_*`로만 도달. 클라이언트가 `(provider, external_key)` + payload를 넘기고 서버가 `resolve_app_user`로 app_user 확정 후 그 소유로 write. **spoof blast radius = localStorage 상태와 동급.**
- **Phase 0 v2 예약 훅 (검증됨):**
  - `app_users.auth_user_id uuid` — **`auth.users` FK 없음**(line 354; 리포 전체에 `references auth` 0건), NULL in v1, unique-where-not-null(line 359-360).
  - `user_identities.provider` CHECK가 이미 `'toss_login'` 허용(line 374). `verified boolean` + CHECK `verified=true ⇒ provider='toss_login'`(line 389-392).
  - `merge_app_users(p_keep, p_absorb uuid)` — **service_role 전용**(line 994-995) 순수 데이터 병합 op(완성됨).
  - RLS `*_rw_v2` 정책 템플릿이 주석으로 준비됨(line 1049-1054).
  - `bd_guard_recipe_owner_immutable` 트리거(line 434-463): 비-owner-writer 세션의 `owner_id/is_official/created_by` 변경을 RAISE. `bd_owner_write_allowed()`는 txn-flag 또는 `service_role`만 true(line 328) — **`authenticated` JWT은 owner-writer 아님**.

---

## 2. 범위

### v2 범위 (이번)
- **ROB-614:** 파트너 서버 + mTLS — `authorizationCode` 토큰 교환·검증, 검증된 userKey → app_user, **인증 세션 발급**(§6.3).
- **ROB-615:** 미니앱 `appLogin` 연동 — 로그인 전 익명 탐색 유지, 로그인 시 인증 전환, 클라이언트 신원/세션 라이프사이클(§4.4).
- **ROB-617:** 신원 병합(`toss_anon`→`toss_login`) + `authenticated` RLS **추가** + **legacy write RPC의 authenticated grant 회수**(§6.6) + 인증 write 경로(§6.5).
- **스코프 최소화:** userKey 확보에 필요한 **최소 스코프만**. `user_ci`·`user_email`·`user_phone` 등 **미요청** → 암호화 PII 복호화 키 취급 불필요, 개인정보보호법/추가 심사 부담 회피.

### v2 비범위 (→ ROB-616, 보류)
웹 토스 로그인, `web_local`→`toss_login` 병합, "웹↔토스에서 동일하게 보임". **웹은 v1 익명(`web_local`) 그대로 유지.**

---

## 3. 신원 모델 (post-v2)

| 표면 | 상태 | provider | external_key | 권한 판정 |
|---|---|---|---|---|
| 미니앱 | 로그인 전 | `toss_anon` | getAnonymousKey 해시 | SECURITY DEFINER RPC (anon grant, 유지) |
| 미니앱 | 로그인 후 | `toss_login` (verified) | userKey 파생 키(§6.1) | `authenticated` RLS(`auth.uid()`) + auth RPC. **legacy RPC 경로 차단(§6.6).** |
| 웹 | (항상) | `web_local` | localStorage UUID | SECURITY DEFINER RPC (anon grant, 유지) |

**불변식:** 익명 경로(`toss_anon`/`web_local`)는 **anon 롤에 대해** 계속 살아있다. 그러나 **로그인(authenticated) 세션에서는 legacy spoofable RPC 경로를 닫는다**(§6.6) — 그렇지 않으면 인증 RLS가 무의미해진다.

---

## 4. 아키텍처

### 4.1 파트너 서버 (ROB-614) — 인증 키스톤

**로그인 요청 컨트랙트** (클라이언트 → 파트너 서버):
```
POST /auth/toss/login
{ authorizationCode: string, referrer: 'DEFAULT'|'SANDBOX',
  anonExternalKey?: string }   // 보유 중인 toss_anon 키(병합용, 617에서 사용)
→ 200 { session: <Supabase 세션> }   // §6.3
```

책임:
1. `{authorizationCode, referrer}` 수신.
2. **mTLS**로 토스 `generate-token` 호출 → `accessToken`.
3. `login-me`(Bearer) → **검증된 userKey** (최소 스코프).
4. `userKey` → **external_key 파생**(§6.1) → `resolve_verified_toss_user(...)`(신규, **service_role 전용**, §6.2) → app_user 확정 + `toss_login` 신원(verified=true) + `auth_user_id` 세팅.
5. **인증 세션 발급**(§6.3) → 클라이언트 반환.
6. *(617 기능)* `anonExternalKey`가 있으면 병합 처리(§6.6) — **614 단독에는 병합 없음**.

비밀(레포 밖 secret manager): 토스 client secret, mTLS 키/인증서, (세션 방식에 따라) Supabase service_role 또는 JWT 서명 키. 최소 스코프라 **PII 복호화 키 불필요**.

### 4.2 미니앱 클라이언트 (ROB-615)
- 로그인 전: 기존 `resolveIdentity()` = `toss_anon` 익명 탐색/조회. 저장 액션에서 로그인 CTA.
- 로그인: `appLogin()` → `authorizationCode`(+보유 `toss_anon` 키) 파트너 서버 전달 → 세션 수신 → Supabase 클라이언트에 set → 클라이언트 신원 상태 전환(§4.4).
- 로그아웃/만료 처리(§4.4).

### 4.3 인증 RLS + legacy 경로 차단 (ROB-617)
- **인증 RLS 추가:** `*_rw_v2` 템플릿을 user_gear/saved_recipes/saved_beans/grinder_calibration에 적용(`for all to authenticated using (app_user_id in (select id from app_users where auth_user_id = auth.uid()))`). recipes는 owner update 정책(`owner_id ∈ auth.uid() 매핑 and is_official=false`).
- **legacy write 경로 차단(ship-blocking, §6.6):** `rpc_save_recipe / rpc_save_bean / rpc_upsert_gear / rpc_upsert_calibration / rpc_create_owned_recipe`의 `authenticated` grant를 **회수**(anon 유지). 안 하면 로그인 사용자가 `rpc_*('toss_anon', <피해자 키>, ...)`로 RLS를 우회해 타인 컬렉션에 write 가능(SECURITY DEFINER는 RLS를 우회).
- **anon 경로 유지:** anon 롤의 deny-all + RPC 경로는 그대로(웹·로그인 전 미니앱).

### 4.4 클라이언트 신원/세션 라이프사이클 (ROB-615)
- `Identity` 타입에 `'toss_login'` 추가 + `authenticated: boolean`(또는 별도 `AuthSession` 개념). 로그인/로그아웃 시 `resolveIdentity()`의 memo 캐시 **무효화**.
- 로그인 후 `resolveIdentity()`는 인증 신원 반환, **데이터 호출은 §6.5 인증 경로로 스위치**(legacy RPC 호출 중단).
- **로그아웃:** Supabase 세션 클리어 → 익명 신원으로 복귀(이전 `toss_anon` 키 또는 재생성) → 캐시 무효화.
- **세션 만료(401):** 익명 read-only로 강등 + 로그인 CTA 표시(refresh 흐름은 §6.3에서 확정).

### 시퀀스 (로그인)
```
미니앱            파트너 서버                 토스 API              Supabase
  │ appLogin()                                                       
  │─authCode(+anonKey)─▶                                             
  │                │─generate-token(mTLS)─▶│                          
  │                │◀── accessToken ───────│                          
  │                │─login-me(Bearer)─────▶│                          
  │                │◀── userKey ───────────│                          
  │                │ derive external_key(§6.1)                        
  │                │─resolve_verified_toss_user(...)─(service_role)──▶│
  │                │◀─ app_user_id, auth_user_id ────────────────────│
  │                │ issue session(§6.3: GoTrue admin 기본) ─────────▶│
  │◀── session ────│                                                 
  │ set session → authenticated RLS로 동작 (§6.5) ───────────────────▶│
  │ ── (617) merge_app_users(keep, absorb) trigger ────────(§6.6)────▶│
```

---

## 5. 데이터 / 스키마 변경

1. **신규 `resolve_verified_toss_user(...)`** — service_role 전용. resolve-or-create app_user + `toss_login` 신원(verified=true) upsert + `auth_user_id` 세팅. 멱등·충돌 처리(§6.2). **anon `resolve_app_user`는 불변**(여전히 toss_login 거부).
2. **`*_rw_v2` 정책 활성화** — user_gear/saved_recipes/saved_beans/grinder_calibration + recipes owner update.
3. **인증 write RPC 변형** — `auth.uid()`에서 app_user 파생. 최소: `rpc_save_recipe_auth`(snapshot 캡처 재사용), `rpc_create_owned_recipe_auth`(가드상 직접 insert는 owner_id가 NULL로 강제되므로 필수). 단순 CRUD는 직접 테이블(§6.5).
4. **legacy write RPC의 `authenticated` grant 회수**(§6.6).
5. **v1 보류 스키마 하드닝 재적용**(`brewdial-identity-schema` 배포 노트의 2건: `bd_owner_write_allowed`/guard `search_path` 핀, `rpc_upsert_gear` 기본장비 충돌 방지) — **617 배포에 포함**(스키마 만지는 티켓).

---

## 6. 핵심 설계 결정 (확정) & 스파이크

### 6.1 userKey → external_key 파생 (확정: 단일 결정론적·단사·고정길이)
`external_key = lower(hex(sha256('brewdial:toss_login:v1:' || <raw userKey>)))` → 항상 **64 hex**(16~256 CHECK 충족, line 387), 충돌 저항, **raw userKey 바이트 사용 — lossy normalization 금지**(자릿수/leading-zero/unicode 정규화로 두 사용자가 병합되는 사고 방지). 버전 프리픽스(`v1`)로 향후 규칙 변경 시 silent 충돌 방지. **string-concat(`'toss_login:'+userKey`) 방식 금지**(<16자 DoS + 정규화 충돌).
- *(614 스파이크: 실제 userKey 포맷·자릿수 확인 — 파생식 자체는 포맷 불문 안전하나 raw 바이트 정의를 고정.)*
- 경계 테스트(§8): <16자/leading-zero userKey, 단사성(injectivity).

### 6.2 검증 resolver — service_role 전용 + 멱등/충돌 (확정)
`resolve_verified_toss_user`: (a) `(provider='toss_login', external_key=파생)`로 SELECT → 있으면 그 app_user 반환하되 `auth_user_id`가 **다른 non-null 값이면 RAISE**(절대 덮어쓰기/이중 attach 금지); (b) 없으면 app_user 생성 + `auth_user_id` 세팅 + verified 신원 insert; (c) `resolve_app_user`처럼 식별자 키로 advisory lock 직렬화(line 745 패턴); (d) 재로그인 멱등. **anon이 호출 불가(grant service_role only).** anon `resolve_app_user`는 그대로 toss_login 거부 → 검증 신원 위조 차단.

### 6.3 인증 세션 — **GoTrue 관리 유저 기본** (custom-JWT는 조건부 fallback)
- **기본(권장): GoTrue admin이 Supabase auth 유저 생성/조회.** userKey에 결정론적으로 매핑(예: 합성 식별자/이메일 `toss+<sha256(userKey)>@brewdial.invalid` 또는 매핑 테이블)해 멱등. `auth_user_id = 그 auth.users.id`. admin API로 세션 발급. **장점:** `auth.uid()`가 실제 `auth.users` 행에 anchor됨, **refresh·로그아웃·ban(revocation) 무료**, JWT 서명 시크릿을 파트너 서버에 노출 안 함.
- **fallback(조건부): custom-JWT** (`sub=auth_user_id`, role=`authenticated`, Supabase JWT 시크릿 서명). **착수 전 검증 필수:** 프로젝트 JWT 서명 체계가 **legacy HS256 공유 시크릿인지 신규 asymmetric signing keys인지** — signing keys면 대칭 서명 토큰이 거부되어 **불가**. 또한 FK-less `auth_user_id` + 서명 시크릿 = **임의 계정 위조 마스터키**(revocation 없음). 채택 시: 짧은 exp + 파트너 서버 refresh 엔드포인트 + jti denylist(로그아웃/ban용) 필수.
- **결정:** 특별한 이유 없으면 GoTrue 경로. (614 스파이크에서 admin 세션 발급 흐름 + auth.uid() 실측 확인.)

### 6.4 CF Worker mTLS (스파이크)
Worker outbound mTLS(클라이언트 인증서 바인딩) 지원 여부 614 첫 스텝 확인. 지원 시 Worker 내 처리, 미지원 시 소형 Node 파트너 서비스.

### 6.5 인증 사용자 write 경로 (확정)
- **단순 CRUD**(saved_recipes 저장/해제, saved_beans, user_gear, grinder_calibration)은 `*_rw_v2` RLS 하 **직접 테이블** 접근.
- **서버사이드 로직 필요분은 auth RPC 변형:** `saved_recipes`의 **snapshot 캡처**는 `rpc_save_recipe_auth`(auth.uid() 파생). **owned recipe 생성**은 `bd_guard_recipe_owner_immutable`가 직접 insert의 `owner_id`를 NULL로 강제하므로 **반드시** `rpc_create_owned_recipe_auth` 경유.
- **authenticated UPDATE 정책은 `is_official/created_by/owner_id`를 건드리지 않는다**(건드리면 가드 RAISE). 클라이언트 update는 가변 컬럼만. (테스트: 인증 사용자가 `is_official=true` 시도 → 실패, owned-create 직접 insert → unowned 확인.)

### 6.6 신원 병합 하드닝 (ROB-617, 확정 + 잔여위험 명시)
- **소유 위치:** 병합 호출은 **617**(보안/데이터 코어). 614 파트너 서버는 `anonExternalKey`를 받아두되 병합 invoke는 617에서 추가.
- **anon→app_user 매핑:** `SELECT app_user_id FROM user_identities WHERE provider='toss_anon' AND external_key=$1` — 없으면 **no-op 병합**(미사용 익명은 흡수할 것 없음).
- **방향·보호:** `keep`=인증 toss_login, `absorb`=toss_anon **만**. **verified 신원은 절대 absorb 금지.** lower-trust→higher-trust 단방향.
- **세션 바인딩(권장):** absorb할 anon 키는 클라이언트가 임의 제출한 값이 아니라 **같은 디바이스 세션에 서버가 앞서 발급/관찰한 값**(nonce/세션 바인딩)이어야 함 — anon 키가 spoofable이므로.
- **잔여위험(정직히):** `merge_app_users`는 `recipes.owner_id`·`feedback.owner_id`·`bean_photos`·saved_*/gear/calibration/`user_identities`를 re-point하고 absorb app_user를 **삭제**(line 982-986). 세션 바인딩 없이 spoofable anon 키를 신뢰하면 **추측 가능한 피해자 익명 신원의 파괴적 탈취**(소유 레시피 절도 포함)가 가능 — "저가치 복사"가 아님. 따라서 세션 바인딩 + abuse rate-limit 적용, 잔여위험 문서화.

---

## 7. 보안 모델 / 위협 (정확화)

- **올리는 것:** 미니앱 로그인 사용자는 검증된 신원(verified `toss_login`)으로 동작하고, **legacy spoofable write RPC가 authenticated에서 회수(§6.6/§4.3)** 되어야 비로소 "추측 기반 타인 접근"이 닫힌다. 회수 전에는 인증 RLS만으로는 닫히지 않음(리뷰 지적).
- **유지되는 위협(수용):** **anon 롤** 경로는 v1과 동일하게 spoofable(웹 + 로그인 전 미니앱). 위협모델 = 익명 키 추측, blast radius = 익명 컬렉션. v2는 anon 롤에 대해선 닫지 않음(범위 한정).
- **병합 위협:** §6.6 — 세션 바인딩으로 완화, 잔여위험 문서화.
- **비밀:** GoTrue 경로면 JWT 서명 시크릿을 파트너 서버에 노출하지 않음(custom-JWT의 마스터키 리스크 회피). service_role 키는 v1처럼 서버 전용. 토스 secret·mTLS 키 격리. 최소 스코프라 PII 복호화 키 없음.

---

## 8. 테스트 전략
- **파트너 서버(614):** 토큰 교환 mock(mTLS), 검증 실패/만료/재시도, external_key 파생 단사성·길이 경계, **세션 발급 → auth.uid()가 올바른 app_user 해석(실 RLS 통합테스트)**.
- **RPC/RLS(617):** `resolve_verified_toss_user` service_role 전용 강제(anon 거부), `resolve_app_user`가 여전히 toss_login 거부, **legacy write RPC가 authenticated에서 거부**(회수 확인), `*_rw_v2`가 본인 행만 허용/타인 거부, 인증 사용자 `is_official=true` 차단, `merge_app_users` 멱등·세션바인딩·verified-absorb 거부.
- **미니앱(615):** 로그인 전 익명 유지, 로그인 후 신원 전환, 병합 후 컬렉션 보존, **JWT 만료→익명 fallback**, 로그아웃.
- 기존 게이트: shared/mcp 유닛 + miniapp tsc.

## 8.1 관측성 (Observability)
파트너 서버: 토큰 교환 각 단계·실패모드, mTLS 오류, 세션 발급, 병합 결과(no-op vs N행 흡수), 로그인 성공/실패율을 구조화 로깅 + **Sentry**(리포에 이미 존재, commit db202f4) 연동. **절대 로깅 금지:** 토큰, raw userKey, 파생 키, 세션.

---

## 9. 롤아웃 순서
`ROB-614`(파트너 서버 + mTLS + `resolve_verified_toss_user` + 세션 발급, **병합 없음**) → `ROB-615`(미니앱 appLogin + 신원/세션 라이프사이클) → `ROB-617`(`*_rw_v2` 정책 + **legacy grant 회수** + 인증 write RPC + 병합 트리거 + 하드닝 재적용). 스키마는 add/회수 모두 무중단 적용 가능. 웹 변경 없음. (`ROB-616`은 계약 확보 후 별도.)

---

## 10. 열린 질문 (스파이크로 좁힘)
- 토스 userKey 실제 포맷/자릿수 (파생식은 포맷 불문 안전, raw 바이트 정의만 고정 — 6.1).
- CF Worker outbound mTLS 지원 여부 (6.4).
- userKey 확보 **최소 스코프** 정확 집합(`user_key` 단독 여부).
- GoTrue admin 세션 발급 정확 흐름(admin createUser + 세션 발급 API) — custom-JWT fallback이면 서명 체계 확인(6.3).
- 다기기 익명 컬렉션 병합 정책(현재 merge 1:1; 에픽 열린 질문 유지).
