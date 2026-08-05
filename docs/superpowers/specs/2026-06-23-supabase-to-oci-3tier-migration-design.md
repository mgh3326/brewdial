# BrewDial — Supabase → OCI 3-tier 이전 (Spec 1 · v1 기능 패리티)

- **작성일:** 2026-06-23 (적대적 리뷰 1회 반영)
- **결정:** 플레인 PostgreSQL(OCI) + **제대로 구조화된 TS 백엔드**(3-tier) / **즉시 웹 전환 + 게이트된 .ait 이행**(순수 빅뱅 아님) / 모든 클라이언트는 CF 프록시 도메인 경유(오리진 은닉)
- **관계:** v2 토스 인증(Spec 2)의 **선행 기반**. 기존 Supabase 중심 v2 스펙(`2026-06-23-v2-toss-auth-miniapp-core-design.md`, commit `2b726b5`)은 이 기반 위에서 재작성됨.
- **메모리:** `brewdial-identity-schema`, `brewdial-deployment-inplace`, `appintoss-port`

---

## 0. 요약

BrewDial은 현재 **백엔드가 없다.** 브라우저(miniapp/web)는 `@supabase/supabase-js`(anon 키), MCP는 service_role 키로 각자 Supabase PostgREST에 직접 붙는다. PostgREST + RLS + 16개 SECURITY DEFINER 함수가 곧 API이자 인증 레이어다.

이 스펙은 그 전부를 **OCI 인스턴스(2 OCPU/12GB)의 플레인 PostgreSQL + 커스텀 TS 백엔드(3-tier)** 로 옮긴다. DB는 백엔드만 접근(private), 모든 클라이언트(miniapp/web/MCP)는 백엔드 HTTP API 경유. **기능 변화 없음(v1 패리티)** — 토스 인증은 Spec 2.

**왜 지금:** v2 인증을 Supabase(GoTrue/RLS/custom-JWT)에 쌓으면 이전 시 두 번 만들게 됨. 백엔드가 신뢰 경계가 되면 v2 인증의 가장 어려운 문제들(custom-JWT 마스터키, SECURITY DEFINER RLS 우회)이 사라진다 — 그래서 이전이 v2의 선행.

> **⚠️ 컷오버 핵심(리뷰 critical):** "빅뱅"은 **웹 한정**으로만 성립한다. 웹 SPA는 CF 배포로 즉시 전환되지만 **토스 `.ait`는 빌드 타임에 API URL이 인라인 + 토스 심사·전파 지연**이 있어 원자 전환 불가. 따라서 컷오버는 **(1) 즉시 웹 전환 + (2) 게이트된 .ait 이행**이고, **Supabase는 컷오버 순간 쓰기-동결(서버 강제) 후 read-only fallback으로 유지**하다가 .ait 채택률이 임계 넘고 OCI 백업이 검증된 뒤에야 **삭제**한다. 안 그러면 구 .ait의 쓰기가 Supabase로 들어가 split-brain/데이터 유실. (§9)

---

## 1. 현재 상태 (스캔으로 확정)

- **모노레포(pnpm 10, Node ≥22, ESM, TS):** `apps/miniapp`(React18+Vite6, `.ait`/web 두 빌드), `apps/mcp`(Node MCP, stdio, fetch PostgREST + service_role), `packages/shared`(타입+도메인 로직, DB 비의존 — **그대로 이식**).
- **데이터 표면이 작고 격리됨.** miniapp의 모든 DB 접근이 `src/lib/supabase.ts` + `src/lib/data/*` 8개 모듈에 집중:
  - **읽기:** `recipes`(recent/by-code/by-bean), `bean_summaries`(뷰), `grinders`, `drippers`, `feedback`(by-recipe), `preferences`(global, 미사용).
  - **쓰기(직접):** `recipes` insert(manual), `feedback` insert.
  - **RPC 6종:** `rpc_save_recipe`, `rpc_save_bean`, `rpc_my_collections`, `rpc_upsert_gear`, `rpc_create_owned_recipe`(미사용), `rpc_upsert_calibration`.
- **web = 같은 코드**(VITE_TARGET=web). identity만 다름(web_local vs toss_anon). **API URL은 두 빌드 모두 빌드 타임 인라인**(`vite.config.ts`가 누락 시 빌드 실패).
- **MCP:** 별도 fetch 클라이언트, service_role, 11개 툴. 읽기+쓰기. per-user 식별 RPC 미사용 → 작성물은 created_by='agent', owner_id NULL.
- **미사용:** Storage/Realtime/Edge Function/Supabase Auth 전부 없음.
- **스키마 이식성:** vanilla Postgres 호환. 유일 확장 `pgcrypto`(코어), `bean_summaries`는 `security_invoker`(PG≥15), `recipe_code_seq`는 import 후 setval 필요.
- **⚠️ 이식 안 되는 것 = 인증 레이어:** RLS 정책 + anon/authenticated/service_role 롤 GRANT + `bd_owner_write_allowed()`의 `request.jwt.claims` GUC 의존(PostgREST 주입). 플레인 PG엔 이걸 채우는 게 없다 → 이 GUC 의존만 제거하고 가드 자체는 보존(§4.6).

---

## 2. 목표 / 비목표

**목표(이번):** 기능 패리티로 백엔드/DB 기반 교체. 현재 **모든 읽기/쓰기/RPC + 11개 MCP 툴**을 커버하는 백엔드 API, miniapp/web 데이터 계층 교체, MCP 재연결, 데이터 이전, Supabase 폐기.

**비목표:** 토스 인증(Spec 2), 웹↔토스 동기화(ROB-616). v1은 이전 후에도 **여전히 익명**(신뢰 경계만 클라이언트→백엔드로 이동). 신규 기능 없음.

---

## 3. 타깃 아키텍처

```
[Toss .ait miniapp]        [web SPA @ CF]            [MCP server]
         \                      │                         │ agent token
          \   /api/* (프록시 도메인, 런타임 설정)          │
           ▼──────────────► [CF Worker proxy] ──(CF Tunnel)──┐
                                                             ▼
                            [Backend API (OCI, Node/TS, Hono)]
                              · authz/세션 · 비즈니스 로직 · (Spec2: 토스 mTLS)
                              ▼  (127.0.0.1, least-priv role)
                            [PostgreSQL (OCI, private — 백엔드만)]
```

- **모든 클라이언트가 동일 프록시 도메인 경유**(웹 + .ait). **CF Worker가 `/api/*`를 Cloudflare Tunnel로 OCI에 프록시** → OCI 오리진은 외부에서 직접 접근 불가(은닉), TLS·DDoS는 CF 엣지. (`.ait`도 직결 대신 이 도메인을 호출 → 별도 CORS 오리진 핀 불필요.)
- **OCI 인스턴스:** Postgres + 백엔드 동일 박스. Postgres는 `127.0.0.1` 바인드 + 방화벽으로 외부 미노출, 백엔드는 least-priv DB 롤로 접속.
- **헤더 패스스루:** 프록시는 `Authorization`, `X-BrewDial-Identity`(§4.5), `Content-Type`를 OCI로 전달.

---

## 4. 백엔드 설계 (proper TS project)

### 4.1 런타임/스택 (결정)
- **Node 22 + TS(ESM)**, 프레임워크 **Hono**. 드라이버 `postgres.js`(또는 `pg`).
- 신규 워크스페이스 `apps/api`(`@brewdial/api`) + `packages/db`(`@brewdial/db`: 스키마/마이그레이션/리포지토리/캐노니컬 mapper). `packages/shared` 재사용.
- **마이그레이션/쿼리 툴(결정):** `schema.sql`을 진실원천으로 두는 현 방식과 일관되게 **node-pg-migrate(또는 dbmate) + Kysely(+kysely-codegen)**. Drizzle(schema-as-TS)은 진실원천을 TS로 옮겨야 해 §5의 pg_dump-from-existing 접근과 충돌 → 채택 안 함.

### 4.2 레이어링
`routes(Hono)` → `services`(비즈니스 로직/트랜잭션/authz) → `repositories`(SQL, `packages/db`) → `db`(풀). 검증은 `packages/shared`. **신뢰 경계 = service 계층 authz.**

### 4.3 API 표면

**클라이언트 읽기:** `GET /api/recipes?status=active&limit=` · `GET /api/recipes/:code`(test 제외) · `GET /api/recipes?beanId=` · `GET /api/beans`(recipe_count>0) · `GET /api/beans/:id` · `GET /api/grinders` · `GET /api/drippers` · `GET /api/recipes/:code/feedback`.

**클라이언트 쓰기/개인화(신원 스코프, §4.5):** `POST /api/recipes`(manual) · `POST /api/recipes/:code/feedback` · `POST /api/me/saved-recipes` · `POST /api/me/saved-beans` · `GET /api/me/collections`(복합 응답 유지) · `PUT /api/me/gear` · `PUT /api/me/calibration`.

**에이전트/관리 표면(MCP 패리티 — in-scope, §7):** `GET /api/beans?q=&limit=`(find_bean 부분일치 검색) · `POST /api/agent/recipes`(created_by=agent) · `PATCH /api/agent/recipes/:code`(update/version-bump) · `PATCH /api/agent/recipes/:code/status`(active/archived/superseded/test) · `POST /api/agent/recipes/supersede`(oldCode,newCode) · `GET /api/agent/recipes/:code?anyStatus=1` · `POST /api/agent/feedback`(source=agent/coffee_profile) · `GET /api/agent/context`(buildRecent/RecipeContext 서버 유지). 에이전트 토큰 인증.

**드롭(미사용, 스키마는 유지):** `getGlobalPreference`(현 무호출) · `rpc_create_owned_recipe`(현 무호출) → v1 백엔드 surface에서 **빌드 안 함**. 단 owner_id/가드 스키마는 보존 — Spec 2 §6.5가 owned-recipe 생성을 인증 하에 재도입.

**응답 형태 계약(재정의):** "byte-identical"이 아니라 — row-mapper(`rowToRecipe/rowToFeedback`, `RECIPE_COLUMNS/FEEDBACK_COLUMNS`)가 기대하는 **row 입력 형태(snake_case 컬럼셋, null vs absent 의미)** 를 그대로 반환해 클라이언트 mapper가 불변 실행되게 한다. `rpc_my_collections` 복합 응답(camelCase savedRecipes/.../myRecipes)은 **별도 계약**으로 핀. **컷오버 전 라이브 Supabase 응답으로 골든 픽스처 캡처**(§10)해 회귀 비교.

### 4.4 비즈니스 로직 — TS service 중심, 단 atomic primitive·트리거는 Postgres 유지
"적절한 백엔드 프로젝트"로 로직은 TS service에 둔다. **단, 검증된 원자성/무결성 원시primitive는 재발명하지 않고 Postgres에 유지**(recipe_code_seq와 동급):
- **recipe_code_seq:** Postgres 시퀀스 유지, 백엔드는 `nextval` 호출.
- **resolve_app_user:** **Postgres 함수 그대로 포팅(advisory-xact-lock + SELECT-then-INSERT).** ON CONFLICT 단발 upsert는 **orphan app_users 경합**을 만들 수 있어 부적절 — M1 fix가 막던 그 레이스. service가 이 함수를 호출.
- **find_or_create_bean + recipes_link_bean(BEFORE INSERT 트리거), set_updated_at:** Postgres 트리거 유지.
- **merge_app_users:** 트랜잭션으로 TS 재구현 또는 함수 유지(Spec 2에서 사용).
- 그 외 조회/조합/검증 로직은 TS service.

**트리거 vs TS 경계(명시):** 살아남는 트리거가 소유하는 효과는 **TS가 세팅하지 않는다** — (a) `updated_at`(set_updated_at), (b) bean 자동 링크. **예: `POST /api/recipes`(manual)** — service는 `created_by='manual'`을 **서버에서 하드코딩**, `bean_snapshot`은 그대로 전달, `bean_id`는 클라이언트 미지정 시 **NULL로 두어** `recipes_link_bean` 트리거가 (name,roaster) 정규화 dedup을 수행하게 한다(백엔드가 bean_id를 미리 resolve하면 트리거가 안 뜸). `owner_id/is_official/created_by`는 **요청 바디에서 절대 수용하지 않음**(서버 결정).

### 4.5 신원 흐름 (v1 — 익명, RLS 없음)
- 클라이언트는 익명 신원 `(provider, external_key)`를 **`X-BrewDial-Identity` 헤더**로 전달(프록시 패스스루). service가 `resolve_app_user`로 app_user 확정 후 **모든 `/api/me/*` 쿼리를 그 app_user_id로 스코프**(RLS가 사라졌으므로 스코핑은 전적으로 백엔드 책임).
- anon 쓰기 규칙 보존: 클라이언트는 manual recipe / web feedback만; agent/official은 `/api/agent/*`(에이전트 토큰).
- **Spec 2 스왑 포인트:** `/api/me/*` 라우트는 그대로 두고 신원 출처만 헤더→백엔드 발급 세션으로 교체되도록 설계.

### 4.6 무엇을 남기고 무엇을 버리나
| 유지 (Postgres) | 폐기 (Supabase-ism) |
|---|---|
| 테이블·FK·CHECK·unique 인덱스 | RLS 정책 전부 |
| `recipe_code_seq`, **`resolve_app_user`(verbatim)** | anon/authenticated/service_role 롤 GRANT |
| `set_updated_at`, `find_or_create_bean`, `recipes_link_bean` 트리거 | `request.jwt.claims` GUC 의존 |
| **`bd_guard_recipe_owner_immutable`**(GUC 의존만 제거, 행 불변 로직 유지) | PostgREST 자체 |
| `bean_summaries` 뷰(또는 백엔드 쿼리), pgcrypto | `bd_owner_write_allowed`의 GUC 분기 → 백엔드 신뢰/txn-flag로 대체 |

> **가드 보존 이유(리뷰):** `bd_guard_recipe_owner_immutable`은 owner_id/is_official/created_by의 **행 불변성**을 강제하는 벤더 중립 로직이고 **Spec 2 §6.5가 이에 의존**한다. `bd_owner_write_allowed`의 PostgREST-JWT 분기만 제거하고 txn-local 플래그(definer 경로) + 백엔드-신뢰로 대체한다. → §12의 "드롭 vs CHECK"는 **유지로 결정.**

---

## 5. 데이터 이전
- **스키마 적용은 `schema.sql` verbatim 금지** — 플레인 PG에선 첫 `to anon` GRANT/RLS에서 실패. §4.6 "유지" 부분집합만 담은 **파생 DDL**을 마이그레이션 툴(§4.1)의 진실원천으로. (RLS/role GRANT/`bd_owner_write_allowed` GUC 분기/SECURITY DEFINER rpc_* 제거; rpc_*는 TS 재구현 또는 유지분만.)
- `pg_dump --data-only`(또는 `--column-inserts`)로 데이터 export → import. 모든 타입 vanilla. `is_official`은 Supabase에서 이미 백필됐으므로 **데이터 덤프가 계산값을 그대로 운반**(추가 백필 불필요 — 확인).
- `create extension pgcrypto;` 선행. PG **≥15**.
- `recipe_code_seq`: import 후 **`setval('recipe_code_seq', (select coalesce(max((substring(code from 5))::int),0) from recipes), true)`** — `--data-only`는 setval을 안 내보내므로 MAX(code)에서 도출. (레시피는 명시 code로 import.)
- 대상 실데이터: recipes/feedback/beans/preferences/grinders·drippers/app_users·user_identities·user_gear·grinder_calibration·saved_*. bean_photos/bean_purchase_links 예약. bd_migration_meta 1행. **auth.users 없음**(v1 익명).

## 6. 클라이언트 변경 (miniapp / web)
- `src/lib/supabase.ts` → **HTTP API 클라이언트**(fetch 래퍼, base = 프록시 도메인 `/api`). `src/lib/data/*` 8개 모듈 호출을 새 엔드포인트로 재배선. 신원은 `X-BrewDial-Identity` 헤더(§4.5). blast radius = 이 디렉토리 + env.
- **.ait API base는 런타임 설정화**(원격 config/부트 시 fetch) — 빌드 타임 인라인 상수 대신. 그래야 향후 API 이동 시 .ait 재제출 불필요 + 컷오버 시 구 클라이언트를 프록시로 유도 가능. (불가하면 .ait 이행은 토스 전파에 게이트 — §9.)
- env: `VITE_SUPABASE_*` 제거, `VITE_API_BASE_URL` 도입. **`vite.config.ts` 빌드 가드를 API_BASE_URL 요구로 교체**(§9 컷오버 빌드의 명시 게이트 — 누락 시 백엔드 타깃 없는 번들이 나감).
- **CF Worker:** 정적 자산 + `/api/*` → CF Tunnel로 OCI 프록시 스크립트 추가(`wrangler.jsonc`에 `main`). 헤더 패스스루(§3).

## 7. MCP 변경 (에이전트 surface in-scope로 결정)
- MCP는 특권 writer(created_by='agent', 임의 status, supersede). **§4.3의 `/api/agent/*` 표면을 이번 컷오버에 포함**해 MCP가 **백엔드 API + 에이전트 토큰**으로만 동작 → DB는 백엔드-only 유지(§11 신뢰 경계·빅뱅 무모순).
- MCP의 fetch 클라이언트는 base URL/토큰 교체로 재연결(저마찰). `src/mappers.ts`는 `packages/db` 캐노니컬 mapper로 단일화(드리프트 방지).
- service_role 시크릿 제거 → 에이전트 토큰만. (직결 Postgres 폴백 **불채택** — 신뢰 경계 위반 회피.)

## 8. OCI 운영
- **배치:** docker compose(postgres + api) 또는 systemd. Postgres `127.0.0.1` 바인드, 외부 5432 도달 불가(보안 리스트 + 사전점검 §9). 백엔드는 **least-priv DB 롤**(슈퍼유저 아님, DDL 불가).
- **오리진/TLS:** **Cloudflare Tunnel**로 OCI 오리진 은닉(공개 IP 미노출). CF 엣지 TLS. (Tunnel이면 Origin Cert/Caddy 택일 불요.)
- **백업:** `pg_dump` 크론 → OCI Object Storage. **Supabase 폐기 전에 OCI 백업 1회 이상 + 스로어웨이 인스턴스 복원 검증**(파일 존재만으론 부족). 보존/PITR 정책 명시.
- **시크릿:** DB 자격·에이전트 토큰·(Spec2)토스 secret/mTLS는 OCI secret 또는 systemd `EnvironmentFile`(권한 제한)/compose secret. **레포 밖, `VITE_` 접두 금지(공개됨).**
- **관측성/로깅:** Sentry(이미 존재) 백엔드 연동, release/environment 태그로 api/miniapp/mcp 구분. 구조화 로깅. **로깅 금지: DB 자격, 에이전트 토큰, raw external_key.**
- **헬스:** `GET /api/health`(liveness, DB 미접속) · `GET /api/db/health`(readiness, `select 1`). (레거시 SvelteKit 형태 참고 불필요 — 그 앱은 폐기됨; 신규 계약 직접 정의. CF/업타임 모니터·canary가 폴.)

## 9. 컷오버 — 즉시 웹 전환 + 게이트된 .ait 이행 (빅뱅 ≠ 즉시 Supabase 삭제)

**준비:** OCI 프로비저닝(PG≥15+pgcrypto 사전점검, 5432 외부 차단 검증), 파생 DDL 적용, 백엔드(클라이언트+에이전트 표면) 전체 구현 + 골든 픽스처 패리티 테스트 통과, 데이터 이전 리허설 1회, **OCI 백업 복원 검증 완료**.

**컷오버 윈도우(짧음, 쓰기 동결):**
1. **Supabase 서버 강제 쓰기-동결** — anon/authenticated/service_role의 INSERT/UPDATE/DELETE GRANT 회수(이게 구 .ait의 in-flight 쓰기까지 막는 **유일한** 방법; 클라이언트측 동결 불가). 읽기는 유지.
2. 최종 `pg_dump` → import → `setval` → **행수+체크섬 diff 게이트**(§10).
3. **웹 즉시 전환:** `VITE_API_BASE_URL`로 web 재빌드 + CF Worker(프록시) 배포. MCP 재연결(에이전트 토큰).
4. **.ait 이행(게이트):** 런타임 설정이면 즉시 프록시로 유도; 아니면 새 .ait 재빌드·**토스 재제출**(심사+전파 지연) 후 채택률 모니터.

**Supabase 존속/삭제:**
- 컷오버 후 **Supabase는 read-only fallback으로 유지**(구 .ait 읽기 동작). 쓰기는 동결됐으므로 split-brain 없음(구 .ait 쓰기는 실패→클라이언트가 에러 표시).
- **삭제(되돌릴 수 없음)는 별도 타임라인:** (a) .ait 새 빌드 채택률이 임계(예: 활성 toss_anon의 >99%) 넘고, (b) OCI 백업 복원 검증 + 사전 체크섬 diff 통과, (c) bake 기간(2–4주) 경과 후에만.

**롤백:**
- go/no-go 게이트: `/api/health`·`/api/db/health` green + 골든 패리티 green + 에러율 기준선.
- 웹 롤백 = **이전 CF Worker 리비전 재배포**(Supabase 가리키는 assets-only) — 한 명령. 이전 리비전 핀 유지.
- **Supabase는 bake 기간 동안 완전 복구 가능 상태로 보존**(read-only지만 미삭제). 늦게 드러난 OCI 장애도 롤백 가능. DROP은 최종·분리·불가역 단계.
- 동결 예상 시간(소규모 덤프+import+검증)을 측정해 "짧은 다운타임" 정량화.

## 10. 테스트 전략
- **골든 픽스처 패리티:** 컷오버 전 라이브 Supabase 응답을 캡처 → 각 엔드포인트가 동일 row-입력 형태/`rpc_my_collections` 복합 형태 반환(클라이언트 mapper 불변).
- **동시성:** `resolve_app_user` N-동시 first-touch 후 **orphan app_users 0 단언**; recipe_code_seq setval 후 프로브 레시피 code=MAX+1.
- 비즈니스: save/upsert 멱등, manual-only/feedback source 화이트리스트, **백엔드가 owner_id/is_official/created_by를 바디에서 무시함을 단언**(parity-test), is_official NOT NULL/default-false 회귀 가드, bean 자동 링크(beanSnapshot only → non-null bean_id), merge 트랜잭션(Spec2).
- **이전 검증:** 행수/체크섬, setval, **사전-삭제 체크섬 게이트**, 백업 복원 테스트.
- 기존 게이트 + 신규 api 유닛/통합.

## 11. 보안 모델
- **백엔드 = 유일 신뢰 경계.** DB private(127.0.0.1, least-priv 롤). OCI 오리진은 CF Tunnel 뒤(직접 도달 불가). 클라이언트는 특권 키 미보유(현 anon publishable 키 제거).
- 시크릿은 OCI(레포 밖, VITE_ 금지). RLS/role 의존 제거 → authz는 백엔드. defense-in-depth로 가드/제약 유지(§4.6).
- **구 anon publishable 키는 배포-by-distribution으로 구 .ait에 박혀 있음** → 구 Supabase 프로젝트 삭제가 그 키를 전역 무효화. 그 프로젝트/키 재사용 금지.
- v1 익명 위협모델 동일(낮음); 클라이언트가 임의 키로 PostgREST를 때리던 표면은 소멸.

## 12. 리스크 / 잔여 열린 질문 (대부분 본문에서 결정됨)
- bake 기간 정확 길이 · .ait 전파/채택 임계 — 토스 콘솔 분석/버전 핑으로 측정(운영 판단).
- `.ait` API base 런타임 설정 실현 방법(원격 config vs 부트 fetch) — 615/이전 구현 시 확정.
- 백업 주기/보존/PITR 구체 수치.
- OCI 단일 인스턴스 SPOF — 중기 리드레플리카/매니지드 PG 검토.

## 13. Spec 2(토스 인증)와의 관계
이 백엔드가 v2의 "파트너 서버". Spec 2는 여기에 **토스 appLogin(mTLS) → 백엔드 세션 → 인증 app_user + merge**를 얹는다. custom-JWT/GoTrue/RLS-우회/spoofable-key 고민은 이 아키텍처에서 소멸. §4.5의 헤더 익명 신원이 그때 백엔드 발급 세션으로 교체(라우트 불변). **보존된 `bd_guard_recipe_owner_immutable` + owner_id 스키마**에 Spec 2의 owned-recipe(인증) 생성이 의존.
