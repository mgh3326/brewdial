# 원두 취향 추천 v2 — S1: 스코어링 엔진 + 매치 밴드 UI (설계)

2026-07-04. ROB-654 "v2" 섹션의 첫 슬라이스. 브레인스토밍 확정 설계.

## 배경 & 스코프

ROB-654(v1)로 프로덕션에 **원두 구조화 속성**(roast_level_ord/acidity/body/decaf/flavor_categories, 13개 원두 백필)과 **글로벌 취향 프로필**(`preferences.likes/dislikes`)이 채워졌다. v1의 추천은 MCP 에이전트 챗에서만 일어난다(§4 통과). v2는 이를 **인앱 결정적 추천**으로 확장한다.

v2는 독립 서브시스템 여러 개다. 이 스펙은 **첫 슬라이스 S1**만 다룬다:

- **S1 (이 스펙)** — 결정적 스코어링 엔진(순수 함수) + `GET /api/me/recommendations` + BeanCard 매치 밴드 배지 + Beans 홈 취향 요약 카드.
- S2 (별도) — 링크 붙여넣기 "다음 살 원두" 후보 스코어링 + `bean_purchase_links` + 재구매 알림.
- S3 (별도) — 데일리/저녁(디카) 2-슬롯 모델.
- S4 (별도) — per-user 취향(토스 로그인 ROB-614와 함께).

**S1 스코프 프레이밍:** v1 레지스트리엔 아직 *유저 소유 원두*만 있다(미소유 카탈로그 없음). 따라서 S1의 매치 밴드는 **기존 원두에 대한 "취향 거울/인사이트"**다 — "내 원두들이 내 취향에 얼마나 맞나 + 내 취향 요약". *미소유 "다음 살 원두"* 후보 스코어링은 S2다.

## 핵심 원칙 (v1에서 계승)

- 파생물(취향 프로필·밴드)은 **읽기 시점 계산**. `user_taste_profiles` 같은 저장 테이블 금지.
- 렌더링: **% / 소수점 금지**, **잘 맞음 / 무난 / 모험 3밴드 + 축별 비교 스트립**.
- 신규 톱레벨 화면 금지(ROB-633 내비 제약) — 기존 Beans 홈 / BeanDetail에 얹는다.

## 아키텍처

**컴포넌트 3개:**

1. **스코어링 엔진** — `packages/shared/src/recommend.ts` (순수 함수, I/O 없음, 완전 유닛 테스트 가능). API가 import; MCP/에이전트도 동일 함수 재사용 가능 → 인앱과 챗 추천 일관.
2. **API** (`apps/api`) — `GET /api/me/recommendations`(읽기, 서버측 스코어링) + `PUT /api/me/preferences`(취향 교정 쓰기).
3. **UI** (`apps/miniapp`) — BeanCard 밴드 배지, BeanDetail 축별 스트립, Beans 홈 취향 요약 카드.

**서버측 스코어링 이유:** miniapp `.ait`는 토스 재심사 게이트라 무겁고, 서버는 rsync+restart로 빠름 → 밴드 임계값/모델을 토스 재제출 없이 서버에서 반복 개선. 순수 함수는 `packages/shared`에 두고 API가 import.

**데이터 흐름:** 클라 `GET /api/beans`(속성 포함, 기존) + `GET /api/me/recommendations`(타깃+밴드) → BeanCard에 밴드 병합 렌더, 홈에 취향 카드.

## 스코어링 모델 (`packages/shared/src/recommend.ts`)

### 축

스코어링 축 4개: `acidity` · `body` · `roastLevelOrd` · `flavorCategories`.
- **`decaf`는 밴드에서 제외** — 카페인 선택이지 맛 축이 아님(유저는 디카/논디카 둘 다 마심). BeanDetail/카드에 칩으로만 표시. (저녁 디카 슬롯은 S3)
- `agtron`은 스코어링에 미사용(roastLevelOrd로 대체; 자주 null).

### 타입

```ts
export interface TasteSignals {
  savedBeanAttrs: BeanAttributes[]      // 유저 저장 원두 속성 (강한 신호)
  ratedBeanAttrs: { attrs: BeanAttributes; overall: number }[] // 고평점 피드백 원두
  preferences: { likes: string[]; dislikes: string[] }         // 명시 태그 (글로벌)
}
export interface TasteTarget {
  acidity?: number      // 1..5 (없으면 미도출)
  body?: number
  roast?: number
  flavorAffinity: BeanFlavorCategory[]
  penalize: ('highAcidity' | 'lightRoast' | 'lowBody')[]  // dislikes에서
  confidence: 'none' | 'low' | 'medium' | 'high'
  summary: string       // "저산미 · 풀바디 · 다크 · 초콜릿·고소"
  evidence: string[]    // 근거 문장들
}
export type MatchBand = 'great' | 'ok' | 'adventure' | 'unknown'
export interface BeanScore {
  band: MatchBand
  axes: { key: string; label: string; value: number | string; target?: number | string; match: 'hit' | 'near' | 'miss' | 'na' }[]
  why: string           // "저산미·풀바디·다크가 취향과 일치"
}
```

### `deriveTasteTarget(signals): TasteTarget` — 하이브리드

1. **행동 베이스**: `savedBeanAttrs` + `ratedBeanAttrs`(overall≥4)의 속성 가중 평균으로 acidity/body/roast 타깃, flavor_categories 빈도로 `flavorAffinity`. (saved 원두에 더 높은 가중.)
2. **태그 보정/override** (샘플 얇을 때 프라이어): `preferences.likes/dislikes` 정규 태그 파싱 → 타깃 당김.
   - likes: "저산미"→acidity 상한(≤2), "다크 로스팅"→roast 하한(≥4), "고소"→nutty_cocoa affinity, "초콜릿/단맛"→sweet+nutty_cocoa affinity.
   - dislikes: "고산미"→`penalize:highAcidity`, "라이트 로스팅"→`penalize:lightRoast`.
3. **confidence**: 신호 개수(saved+rated) + 태그 유무로 none/low/medium/high.
4. 신호 전무 → `confidence:'none'`, 타깃 미도출(빈 affinity).

### `scoreBean(attrs, target): BeanScore` — 결정적

- 속성 없음(`attrsSource` null 등 미백필) → `band:'unknown'`, 가짜 밴드 안 만듦.
- 축별 fit:
  - acidity/body/roast: 타깃과의 근접도(거리 작을수록 hit). `penalize`에 걸린 방향(예: 고산미)이면 miss + 감점.
  - flavor: `attrs.flavorCategories ∩ target.flavorAffinity` 비율.
- **가중합** (acidity 최고 가중 — 지배적 신호, 이후 roast · body · flavor) → 0..1 정규화.
  - 초기 가중: acidity 0.4, roast 0.25, body 0.2, flavor 0.15 (서버 상수, 튜닝 대상).
- 밴드 임계값: **≥0.7 great · 0.4–0.7 ok · <0.4 adventure** (서버 상수).
- `axes`: 축별 방향 스트립(값 + 타깃 + hit/near/miss). `why`: 한 줄 요약. **% 없음.**

### 검증 앵커 (§4 재현, 유닛 테스트로 고정)

현재 프로덕션 데이터로:
- 브릴리(a1/b4/r5, nutty_cocoa·sweet) = **great**
- 콜롬비아 아폰테(a2/b3/r4) = **great**
- 잘 되어 가시나(a3/b4/r3, fruity·sweet) = **ok**
- Ethiopia Guji Uraga(a4/b2/r2, fruity·floral) = **adventure**
- 테스트/인스턴트(속성 없음) = **unknown**

## API (`apps/api`)

### `GET /api/me/recommendations`

- **identity 선택적**: `identityMiddleware`가 `appUserId` 채우면 그 유저의 `saved_beans`(+속성)·피드백을 신호로 사용; 없으면 글로벌 `preferences`만. **`requireIdentity` 안 붙임** → 익명도 200 폴백. (M4 라우트 마운트: `/api/me`, 단 이 라우트만 requireIdentity 제외.)
- 서버: 신호 로드 → `deriveTasteTarget` → 전 레지스트리 원두에 `scoreBean` → 응답.
- 응답:
```json
{
  "tasteProfile": { "targets": {"acidity":1,"body":4,"roast":4.5}, "flavorAffinity": ["nutty_cocoa","sweet"],
                    "penalize": ["highAcidity","lightRoast"], "confidence": "low",
                    "summary": "저산미 · 풀바디 · 다크 · 초콜릿·고소", "evidence": ["…"] },
  "bands": { "<beanId>": { "band": "great", "axes": [ {"key":"acidity","label":"산미","value":1,"target":1,"match":"hit"}, … ], "why": "…" } },
  "ranked": ["<beanId>", "…"]
}
```
- 클라는 `bands`를 기존 `/api/beans` 목록과 병합(원두 페이로드 중복 없음). `ranked`는 선택적 정렬용.
- 신호 전무 → `confidence:'none'`, `bands` 대부분 unknown/비고, 카드가 "원두 저장/취향 설정" 유도.

### `PUT /api/me/preferences`

- "이게 맞나요? ✏️ 교정"용. body `{ likes?: string[], dislikes?: string[] }`.
- **정규 태그 화이트리스트** 검증(shared 검증기): 저산미/고산미, 다크 로스팅/라이트 로스팅, 고소, 초콜릿·단맛, 저녁 디카. 화이트리스트 밖 → 400.
- **현재 `preferences`는 글로벌 싱글톤** → 이 쓰기도 글로벌(1인 앱이라 무방). per-user는 S4(토스 로그인). recon이 지적한 "preferences 프로덕션 쓰기 경로 없음" 갭을 이걸로 메움.
- identity: S1은 글로벌 싱글톤 쓰기라 **`requireIdentity` 안 붙임**(1인 앱이라 무방). per-user 스코핑·인증 게이트는 S4(토스 로그인)에서 도입.
- 교정 후 다음 `GET /me/recommendations`에 즉시 반영(읽기 시점 계산).

## UI (`apps/miniapp`) — A 컴팩트

신규 화면 없음. 기존 Beans 홈 / BeanDetail / BeanCard에 얹는다.

- **BeanCard** (`components/BeanCard.tsx`): 밴드 배지 추가 — 잘 맞음(green) / 무난(amber) / 모험(gray) / 정보 없음(muted). 서버 `bands[beanId].band` 렌더. 목록 깔끔(배지만).
- **BeanDetail** (`pages/BeanDetail.tsx`): 축별 비교 스트립(산미/무게감/로스팅/향미 + 값 + 타깃 + ✓/✗) + `why` 한 줄. decaf 칩.
- **Beans 홈** (`pages/Beans.tsx`): 상단 **취향 요약 카드** — `tasteProfile.summary` + 칩(evidence) + "이게 맞나요?"
  - 👍 = 확인(가벼운 no-op/확정 표시).
  - ✏️ = 정규 태그 토글 시트 → `PUT /me/preferences` → 재조회.
  - `confidence:'none'`이면 "원두를 저장하거나 취향을 알려주세요" 유도 상태.
- 데이터: `pages/Beans.tsx`가 `GET /api/beans` + `GET /api/me/recommendations` 병렬 로드, 병합.
- 실 시각 폴리시는 구현 시 frontend-design 스킬로.

## 테스트

- **`packages/shared` 순수 함수 유닛테스트 (핵심)**: `deriveTasteTarget` + `scoreBean`. 앵커 = 위 §4 기대 밴드. 엣지: 신호 전무→confidence none/타깃 미도출, 속성 없는 원두→unknown, agtron null, dislikes 태그가 고산미 페널티, 태그 override가 얇은 행동 신호를 이김.
- **`apps/api` 테스트**: `GET /me/recommendations`(identity 유/무→200 폴백, 응답 형태, bands 존재, ranked 정렬), `PUT /me/preferences`(화이트리스트 검증, 기록, 다음 rec 반영).
- **miniapp**: 밴드 배지/취향 카드 렌더 + `pnpm --filter @brewdial/miniapp check` 타입체크.
- 전 패키지 `pnpm -r build`/`check` 그린.

## 배포

- 마이그레이션 없음(S1은 스키마 변경 없음 — 속성·preferences는 v1에서 이미 존재). 순수 코드.
- API: rsync + build(shared/db/api) + restart (deploy/oci/README.md).
- miniapp: Cloudflare Worker 자동 빌드(main) + (토스앱은 별도 .ait 제출 — 밴드 UI는 클라 변경이라 토스 재제출 필요).

## 스코프 밖 (후속 슬라이스)

- S2: 링크 붙여넣기 후보 스코어링 + `bean_purchase_links` + "디카 떨어짐→재구매?" 알림.
- S3: 데일리/저녁(디카) 2-슬롯.
- S4: per-user preferences(토스 로그인 ROB-614).
- 결정적 스코어 model 고도화(협업필터링 등)는 데이터 부족으로 보류.

## 확정된 결정 (브레인스토밍)

1. 첫 슬라이스 = S1(엔진+밴드 UI). 2. 취향 도출 = 하이브리드(행동 우선 + 태그 보정). 3. decaf 밴드 제외. 4. 산미 최고 가중 3밴드, % 없음. 5. 속성 없는 원두 = unknown. 6. 서버측 스코어링(토스 재제출 회피). 7. UI = A 컴팩트(카드 배지만, 축 스트립은 BeanDetail). 8. 취향 교정 = `PUT /me/preferences` 글로벌 쓰기(per-user는 S4).
