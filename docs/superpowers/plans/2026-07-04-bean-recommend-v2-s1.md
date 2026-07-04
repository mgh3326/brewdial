# 원두 취향 추천 v2 S1 — 스코어링 엔진 + 매치 밴드 UI (구현 플랜)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원두 구조화 속성 + 취향 프로필로 결정적 매치 밴드(잘 맞음/무난/모험)를 계산해 인앱 Beans 홈/BeanDetail에 노출한다.

**Architecture:** `packages/shared`의 순수 함수 스코어링 엔진(`deriveTasteTarget`/`scoreBean`)을 `apps/api`가 import해 `GET /api/me/recommendations`에서 서버측 스코어링, miniapp은 밴드만 렌더. 파생물은 읽기 시점 계산(저장 테이블 없음), % 없음, 신규 화면 없음.

**Tech Stack:** TypeScript, Kysely(Postgres), Hono(API), React+Vite(miniapp), Vitest.

설계 스펙: `docs/superpowers/specs/2026-07-04-bean-recommend-v2-s1-design.md`.

## Global Constraints

- 렌더링 규칙: **% / 소수점 금지**. 3밴드 = `great`(잘 맞음) / `ok`(무난) / `adventure`(모험) / `unknown`(정보 없음).
- 파생물(취향 타깃·밴드)은 **읽기 시점 계산**. 저장 테이블 신규 금지.
- **신규 톱레벨 화면 금지** — 기존 Beans 홈 / BeanDetail / BeanCard에만 얹는다.
- `decaf`는 밴드 스코어 제외(칩 표시만). `agtron` 스코어 미사용.
- 스코어링 축 4개: `acidity` · `body` · `roastLevelOrd` · `flavorCategories`. 초기 가중 acidity 0.4 / roast 0.25 / body 0.2 / flavor 0.15(가용 축으로 재정규화). 밴드 임계 ≥0.7 great · ≥0.4 ok · <0.4 adventure.
- 정규 취향 태그(화이트리스트): `저산미` `고산미` `다크 로스팅` `라이트 로스팅` `고소함` `초콜릿/단맛` `저녁은 디카페인`.
- `preferences`는 글로벌 싱글톤(S1). per-user는 S4. 스키마 변경 없음(마이그레이션 없음).
- 모든 커밋 메시지 끝: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01PdEGT5gKktgX6iH9PFJpgd`.

## File Structure

- `packages/shared/src/recommend.ts` (신규) — 스코어링 엔진(타입 + `deriveTasteTarget` + `scoreBean`). 순수, I/O 없음.
- `packages/shared/src/recommend.test.ts` (신규) — 엔진 유닛테스트(§4 앵커).
- `packages/shared/src/types.ts` (수정) — `TASTE_TAGS` 상수 + 타입.
- `packages/shared/src/validation.ts` (수정) — `validateUpdatePreferencesInput`.
- `packages/shared/src/validation.test.ts` (수정) — 검증기 테스트.
- `packages/shared/src/index.ts` (수정) — recommend export.
- `packages/db/src/repositories/preferences.ts` (수정) — `setGlobalPreference`.
- `packages/db/src/repositories/recommend.ts` (신규) — `getTasteSignals`(saved/rated beans → 속성 조인).
- `packages/db/src/index.ts` (수정) — recommend repo export.
- `packages/db/src/recommend.test.ts` (신규) — 리포 테스트(DB).
- `apps/api/src/routes/me.ts` (수정) — `GET /recommendations` + `PUT /preferences`.
- `apps/api/src/routes/me.recommendations.test.ts` (신규), `apps/api/src/routes/me.preferences.test.ts` (신규).
- `apps/miniapp/src/lib/data/recommend.ts` (신규) — 추천 fetch + preferences 쓰기.
- `apps/miniapp/src/components/BeanCard.tsx` (수정) — 밴드 배지.
- `apps/miniapp/src/pages/Beans.tsx` (수정) — 추천 로드 + 취향 카드 + 밴드 전달.
- `apps/miniapp/src/pages/BeanDetail.tsx` (수정) — 축별 스트립.

테스트 DB: `DATABASE_URL=postgresql:///brewdial_test`(마이그레이션 001~006 적용됨). API/DB 테스트 앞에 `export DATABASE_URL=postgresql:///brewdial_test`.

---

### Task 1: 정규 취향 태그 상수 + preferences 검증기 (shared)

**Files:**
- Modify: `packages/shared/src/types.ts` (파일 끝에 추가)
- Modify: `packages/shared/src/validation.ts` (파일 끝에 추가)
- Test: `packages/shared/src/validation.test.ts` (추가)

**Interfaces:**
- Produces: `TASTE_TAGS: readonly string[]`, `type TasteTag`, `interface UpdatePreferencesInput { likes: string[]; dislikes: string[] }`, `validateUpdatePreferencesInput(input): ValidationResult<UpdatePreferencesInput>`.

- [ ] **Step 1: 실패 테스트 작성** — `packages/shared/src/validation.test.ts` 끝에 추가

```ts
import { validateUpdatePreferencesInput } from './validation.js';

describe('validateUpdatePreferencesInput', () => {
  it('accepts whitelisted like/dislike tags', () => {
    const r = validateUpdatePreferencesInput({ likes: ['저산미', '다크 로스팅'], dislikes: ['고산미'] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.likes).toEqual(['저산미', '다크 로스팅']); expect(r.value.dislikes).toEqual(['고산미']); }
  });
  it('rejects an unknown tag', () => {
    const r = validateUpdatePreferencesInput({ likes: ['초코비'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/unknown taste tag/);
  });
  it('defaults missing arrays to empty and dedupes', () => {
    const r = validateUpdatePreferencesInput({ likes: ['저산미', '저산미'] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.likes).toEqual(['저산미']); expect(r.value.dislikes).toEqual([]); }
  });
  it('rejects a non-object', () => { expect(validateUpdatePreferencesInput('x').ok).toBe(false); });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @brewdial/shared test -- validation`
Expected: FAIL — `validateUpdatePreferencesInput is not a function`.

- [ ] **Step 3: 타입 상수 추가** — `packages/shared/src/types.ts` 끝에 추가

```ts
// ── ROB-654 v2 S1: 정규 취향 태그(교정 UI 화이트리스트).
export const TASTE_TAGS = [
  '저산미',
  '고산미',
  '다크 로스팅',
  '라이트 로스팅',
  '고소함',
  '초콜릿/단맛',
  '저녁은 디카페인',
] as const;
export type TasteTag = (typeof TASTE_TAGS)[number];
```

- [ ] **Step 4: 검증기 추가** — `packages/shared/src/validation.ts`

파일 상단 import에 `TASTE_TAGS` 추가 (기존 `import { BEAN_ATTRS_SOURCES, BEAN_FLAVOR_CATEGORIES, QUICK_FEEDBACK_TAGS } from './types.js';` 를 아래로 교체):

```ts
import { BEAN_ATTRS_SOURCES, BEAN_FLAVOR_CATEGORIES, QUICK_FEEDBACK_TAGS, TASTE_TAGS } from './types.js';
```

파일 끝에 추가:

```ts
export interface UpdatePreferencesInput {
  likes: string[];
  dislikes: string[];
}

// ROB-654 v2 S1: validate taste preference edits (global singleton write).
export function validateUpdatePreferencesInput(
  input: unknown
): ValidationResult<UpdatePreferencesInput> {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['input must be an object'] };

  const allowed = new Set<string>(TASTE_TAGS);
  const clean = (raw: unknown, field: string): string[] => {
    if (raw === undefined) return [];
    if (!isStringArray(raw)) { errors.push(`${field} must be a string array`); return []; }
    const bad = raw.filter((t) => !allowed.has(t));
    if (bad.length > 0) errors.push(`${field} contains unknown taste tag(s): ${bad.join(', ')}`);
    return [...new Set(raw.filter((t) => allowed.has(t)))];
  };
  const likes = clean(input.likes, 'likes');
  const dislikes = clean(input.dislikes, 'dislikes');

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { likes, dislikes }, warnings: [] };
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @brewdial/shared test -- validation`
Expected: PASS (신규 4개 포함).

- [ ] **Step 6: 커밋**

```bash
git add packages/shared/src/types.ts packages/shared/src/validation.ts packages/shared/src/validation.test.ts
git commit -m "feat(shared): taste tags + validateUpdatePreferencesInput (v2 S1)"
```

---

### Task 2: 스코어링 엔진 (shared, 순수 함수)

**Files:**
- Create: `packages/shared/src/recommend.ts`
- Create: `packages/shared/src/recommend.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `BeanAttributes`, `BeanFlavorCategory` (from `./types.js`, 이미 존재).
- Produces: `interface TasteSignals`, `interface TasteTarget`, `type MatchBand`, `interface AxisComparison`, `interface BeanScore`, `deriveTasteTarget(signals: TasteSignals): TasteTarget`, `scoreBean(attrs: BeanAttributes, target: TasteTarget): BeanScore`.

- [ ] **Step 1: 실패 테스트 작성** — `packages/shared/src/recommend.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { deriveTasteTarget, scoreBean, type TasteSignals } from './recommend.js';
import type { BeanAttributes } from './types.js';

const brily: BeanAttributes = { roastLevelOrd: 5, acidity: 1, body: 4, flavorCategories: ['nutty_cocoa', 'sweet'] };
const dicaprio: BeanAttributes = { roastLevelOrd: 5, acidity: 1, body: 4, decaf: true, flavorCategories: ['nutty_cocoa', 'sweet'] };
const dreamy: BeanAttributes = { roastLevelOrd: 4, acidity: 1, body: 4, decaf: true, flavorCategories: ['nutty_cocoa', 'sweet'] };
const aponte: BeanAttributes = { roastLevelOrd: 4, acidity: 2, body: 3, decaf: true, flavorCategories: ['nutty_cocoa', 'sweet'] };
const jaldoe: BeanAttributes = { roastLevelOrd: 3, acidity: 3, body: 4, flavorCategories: ['fruity', 'sweet'] };
const gujiUraga: BeanAttributes = { roastLevelOrd: 2, acidity: 4, body: 2, flavorCategories: ['fruity', 'floral'] };

const signals: TasteSignals = {
  savedBeanAttrs: [brily, dicaprio, dreamy],
  ratedBeanAttrs: [],
  likes: ['저산미', '고소함', '초콜릿/단맛', '다크 로스팅', '저녁은 디카페인'],
  dislikes: ['고산미', '라이트 로스팅'],
};

describe('deriveTasteTarget', () => {
  it('derives a low-acidity, full-body, dark target from saved beans + tags', () => {
    const t = deriveTasteTarget(signals);
    expect(t.acidity).toBeLessThanOrEqual(2);
    expect(t.body).toBeGreaterThanOrEqual(3.5);
    expect(t.roast).toBeGreaterThanOrEqual(4);
    expect(t.flavorAffinity).toEqual(expect.arrayContaining(['nutty_cocoa', 'sweet']));
    expect(t.penalize).toEqual(expect.arrayContaining(['highAcidity', 'lightRoast']));
    expect(t.confidence).not.toBe('none');
    expect(t.summary.length).toBeGreaterThan(0);
  });
  it('returns confidence none with no signals', () => {
    const t = deriveTasteTarget({ savedBeanAttrs: [], ratedBeanAttrs: [], likes: [], dislikes: [] });
    expect(t.confidence).toBe('none');
    expect(t.flavorAffinity).toEqual([]);
  });
});

describe('scoreBean — §4 acceptance anchors', () => {
  const t = deriveTasteTarget(signals);
  it('brily → great', () => { expect(scoreBean(brily, t).band).toBe('great'); });
  it('aponte → great', () => { expect(scoreBean(aponte, t).band).toBe('great'); });
  it('잘 되어 가시나 → ok', () => { expect(scoreBean(jaldoe, t).band).toBe('ok'); });
  it('guji uraga → adventure', () => { expect(scoreBean(gujiUraga, t).band).toBe('adventure'); });
  it('bean with no attributes → unknown', () => {
    expect(scoreBean({}, t).band).toBe('unknown');
  });
  it('axes have no percent and include a match direction', () => {
    const s = scoreBean(brily, t);
    expect(s.axes.find((a) => a.key === 'acidity')?.match).toBe('hit');
    expect(JSON.stringify(s)).not.toMatch(/%/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `export DATABASE_URL=postgresql:///brewdial_test; pnpm --filter @brewdial/shared test -- recommend`
Expected: FAIL — `Cannot find module './recommend.js'`.

- [ ] **Step 3: 엔진 구현** — `packages/shared/src/recommend.ts`

```ts
import type { BeanAttributes, BeanFlavorCategory } from './types.js';

export interface TasteSignals {
  savedBeanAttrs: BeanAttributes[];        // 강한 신호 (weight 2)
  ratedBeanAttrs: BeanAttributes[];        // overall>=4 피드백 원두 (weight 1)
  likes: string[];
  dislikes: string[];
}

export type TastePenalty = 'highAcidity' | 'lightRoast' | 'lowBody';

export interface TasteTarget {
  acidity?: number;
  body?: number;
  roast?: number;
  flavorAffinity: BeanFlavorCategory[];
  penalize: TastePenalty[];
  confidence: 'none' | 'low' | 'medium' | 'high';
  summary: string;
  evidence: string[];
}

export type MatchBand = 'great' | 'ok' | 'adventure' | 'unknown';

export interface AxisComparison {
  key: 'acidity' | 'body' | 'roast' | 'flavor';
  label: string;
  value: number | string;
  target?: number | string;
  match: 'hit' | 'near' | 'miss' | 'na';
}

export interface BeanScore {
  band: MatchBand;
  score: number; // 0..1 internal, NOT rendered
  axes: AxisComparison[];
  why: string;
}

const AXIS_WEIGHT = { acidity: 0.4, roast: 0.25, body: 0.2, flavor: 0.15 } as const;

function weightedMean(vals: { v: number; w: number }[]): number | undefined {
  const f = vals.filter((x) => Number.isFinite(x.v));
  if (f.length === 0) return undefined;
  const wsum = f.reduce((s, x) => s + x.w, 0);
  return f.reduce((s, x) => s + x.v * x.w, 0) / wsum;
}

export function deriveTasteTarget(signals: TasteSignals): TasteTarget {
  const weighted = [
    ...signals.savedBeanAttrs.map((a) => ({ a, w: 2 })),
    ...signals.ratedBeanAttrs.map((a) => ({ a, w: 1 })),
  ];
  const axis = (pick: (a: BeanAttributes) => number | undefined) =>
    weightedMean(weighted.flatMap(({ a, w }) => { const v = pick(a); return v == null ? [] : [{ v, w }]; }));

  let acidity = axis((a) => a.acidity);
  let body = axis((a) => a.body);
  let roast = axis((a) => a.roastLevelOrd);

  // flavor affinity: frequency across signal beans
  const flavorCount = new Map<BeanFlavorCategory, number>();
  for (const { a } of weighted) for (const f of a.flavorCategories ?? []) flavorCount.set(f, (flavorCount.get(f) ?? 0) + 1);
  const flavorAffinity: BeanFlavorCategory[] = [...flavorCount.entries()].sort((x, y) => y[1] - x[1]).map(([f]) => f);

  // tag overrides/priors
  const likes = new Set(signals.likes);
  const dislikes = new Set(signals.dislikes);
  const penalize: TastePenalty[] = [];
  const addAff = (f: BeanFlavorCategory) => { if (!flavorAffinity.includes(f)) flavorAffinity.push(f); };

  if (likes.has('저산미')) acidity = Math.min(acidity ?? 2, 2);
  if (likes.has('다크 로스팅')) roast = Math.max(roast ?? 4, 4);
  if (likes.has('고소함')) addAff('nutty_cocoa');
  if (likes.has('초콜릿/단맛')) { addAff('sweet'); addAff('nutty_cocoa'); }
  if (dislikes.has('고산미')) penalize.push('highAcidity');
  if (dislikes.has('라이트 로스팅')) penalize.push('lightRoast');
  // '저녁은 디카페인' → S1 밴드에 미반영(디카 슬롯은 S3).

  const signalCount = signals.savedBeanAttrs.length + signals.ratedBeanAttrs.length;
  const hasTags = likes.size + dislikes.size > 0;
  let confidence: TasteTarget['confidence'] = 'none';
  if (signalCount >= 5) confidence = 'high';
  else if (signalCount >= 2) confidence = 'medium';
  else if (signalCount >= 1 || hasTags) confidence = 'low';
  if (signalCount === 0 && !hasTags) return { flavorAffinity: [], penalize: [], confidence: 'none', summary: '', evidence: [] };

  const parts: string[] = [];
  if (acidity != null) parts.push(acidity <= 2 ? '저산미' : acidity >= 4 ? '고산미' : '중간 산미');
  if (body != null) parts.push(body >= 4 ? '풀바디' : body <= 2 ? '가벼운 바디' : '미디엄 바디');
  if (roast != null) parts.push(roast >= 4 ? '다크 로스팅' : roast <= 2 ? '라이트 로스팅' : '미디엄 로스팅');
  const flavLabel = flavorAffinity.slice(0, 2).map(flavorKo).join('·');
  if (flavLabel) parts.push(flavLabel);
  const summary = parts.join(' · ');

  const evidence: string[] = [];
  if (signalCount > 0) evidence.push(`저장·고평점 원두 ${signalCount}종의 공통 프로필`);
  if (hasTags) evidence.push(`명시 취향: ${[...likes].join('·')}`);

  return { acidity, body, roast, flavorAffinity, penalize, confidence, summary, evidence };
}

function flavorKo(f: BeanFlavorCategory): string {
  const map: Record<BeanFlavorCategory, string> = {
    fruity: '과일', floral: '플로럴', sweet: '단맛', nutty_cocoa: '초콜릿·고소', spices: '스파이스',
    roasted: '로스티', cereal: '곡물', sour_fermented: '발효', green: '그린',
  };
  return map[f] ?? f;
}

function closeness(value: number, target: number, span = 4): number {
  return Math.max(0, 1 - Math.abs(value - target) / span);
}
function dir(value: number, target: number): AxisComparison['match'] {
  const d = Math.abs(value - target);
  return d <= 1 ? 'hit' : d <= 2 ? 'near' : 'miss';
}

export function scoreBean(attrs: BeanAttributes, target: TasteTarget): BeanScore {
  const hasData = attrs.acidity != null || attrs.body != null || attrs.roastLevelOrd != null || (attrs.flavorCategories?.length ?? 0) > 0;
  if (!hasData) return { band: 'unknown', score: 0, axes: [], why: '속성 정보가 없어요' };

  const axes: AxisComparison[] = [];
  const fits: { key: keyof typeof AXIS_WEIGHT; fit: number }[] = [];

  // acidity
  if (attrs.acidity != null && target.acidity != null) {
    let fit = closeness(attrs.acidity, target.acidity);
    if (target.penalize.includes('highAcidity') && attrs.acidity >= 4) fit *= 0.3;
    fits.push({ key: 'acidity', fit });
    axes.push({ key: 'acidity', label: '산미', value: attrs.acidity, target: target.acidity, match: dir(attrs.acidity, target.acidity) });
  } else axes.push({ key: 'acidity', label: '산미', value: attrs.acidity ?? '—', match: 'na' });

  // roast
  if (attrs.roastLevelOrd != null && target.roast != null) {
    let fit = closeness(attrs.roastLevelOrd, target.roast);
    if (target.penalize.includes('lightRoast') && attrs.roastLevelOrd <= 2) fit *= 0.4;
    fits.push({ key: 'roast', fit });
    axes.push({ key: 'roast', label: '로스팅', value: attrs.roastLevelOrd, target: target.roast, match: dir(attrs.roastLevelOrd, target.roast) });
  } else axes.push({ key: 'roast', label: '로스팅', value: attrs.roastLevelOrd ?? '—', match: 'na' });

  // body
  if (attrs.body != null && target.body != null) {
    fits.push({ key: 'body', fit: closeness(attrs.body, target.body) });
    axes.push({ key: 'body', label: '무게감', value: attrs.body, target: target.body, match: dir(attrs.body, target.body) });
  } else axes.push({ key: 'body', label: '무게감', value: attrs.body ?? '—', match: 'na' });

  // flavor
  const bf = attrs.flavorCategories ?? [];
  if (bf.length > 0 && target.flavorAffinity.length > 0) {
    const overlap = bf.filter((f) => target.flavorAffinity.includes(f)).length;
    const fit = overlap / Math.min(bf.length, target.flavorAffinity.length);
    fits.push({ key: 'flavor', fit });
    axes.push({ key: 'flavor', label: '향미', value: bf.map(flavorKo).join('·'), match: overlap > 0 ? 'hit' : 'miss' });
  } else axes.push({ key: 'flavor', label: '향미', value: bf.map(flavorKo).join('·') || '—', match: 'na' });

  const wsum = fits.reduce((s, f) => s + AXIS_WEIGHT[f.key], 0);
  const score = wsum === 0 ? 0 : fits.reduce((s, f) => s + f.fit * AXIS_WEIGHT[f.key], 0) / wsum;
  const band: MatchBand = fits.length === 0 ? 'unknown' : score >= 0.7 ? 'great' : score >= 0.4 ? 'ok' : 'adventure';

  const hits = axes.filter((a) => a.match === 'hit').map((a) => a.label);
  const why = band === 'great' ? `${hits.slice(0, 3).join('·')}이(가) 취향과 일치`
    : band === 'ok' ? '일부 축이 취향과 맞아요'
    : band === 'adventure' ? '취향과 꽤 달라요 — 모험' : '속성 정보가 없어요';

  return { band, score, axes, why };
}
```

- [ ] **Step 4: export 추가** — `packages/shared/src/index.ts` 끝에 추가

```ts
export * from './recommend.js';
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @brewdial/shared test -- recommend`
Expected: PASS (§4 앵커 밴드 일치). 실패 시 `AXIS_WEIGHT`/임계값 튜닝(0.7/0.4)으로 앵커 맞춤.

- [ ] **Step 6: 커밋**

```bash
git add packages/shared/src/recommend.ts packages/shared/src/recommend.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): deterministic bean scoring engine (deriveTasteTarget, scoreBean) (v2 S1)"
```

---

### Task 3: DB — preferences 쓰기 + 취향 신호 읽기

**Files:**
- Modify: `packages/db/src/repositories/preferences.ts`
- Create: `packages/db/src/repositories/recommend.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/recommend.test.ts`

**Interfaces:**
- Consumes: `BeanAttributes` (from `@brewdial/shared`).
- Produces: `setGlobalPreference(db, { likes, dislikes }): Promise<PreferenceRow>`; `getTasteSignals(db, appUserId?: string): Promise<{ savedBeanAttrs: BeanAttributes[]; ratedBeanAttrs: BeanAttributes[] }>`.

- [ ] **Step 1: 실패 테스트 작성** — `packages/db/src/recommend.test.ts`

```ts
import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from './db.js';
import { getTasteSignals } from './repositories/recommend.js';
import { setGlobalPreference, getGlobalPreference } from './repositories/preferences.js';

const SEED = randomUUID().replace(/-/g, '').slice(0, 8);
let appUserId: string;
let beanId: string;
let recipeCode: string;

beforeAll(async () => {
  const db = getDb();
  const u = await db.insertInto('app_users').defaultValues().returning('id').executeTakeFirstOrThrow();
  appUserId = u.id;
  const b = await db.insertInto('beans').values({ name: `SigBean ${SEED}`, roast_level_ord: 5, acidity: 1, body: 4, flavor_categories: ['nutty_cocoa', 'sweet'], attrs_source: 'ai_extracted' }).returning('id').executeTakeFirstOrThrow();
  beanId = b.id;
  await db.insertInto('saved_beans').values({ app_user_id: appUserId, bean_id: beanId }).execute();
  const r = await db.insertInto('recipes').values({ method: 'v60', title: `SigRec ${SEED}`, bean_id: beanId, owner_id: null }).returning('code').executeTakeFirstOrThrow();
  recipeCode = r.code;
  await db.insertInto('feedback').values({ recipe_code: recipeCode, bean_id: beanId, ratings: { overall: 5 } }).execute();
});

afterAll(async () => {
  const db = getDb();
  await db.deleteFrom('feedback').where('recipe_code', '=', recipeCode).execute();
  await db.deleteFrom('recipes').where('code', '=', recipeCode).execute();
  await db.deleteFrom('saved_beans').where('app_user_id', '=', appUserId).execute();
  await db.deleteFrom('beans').where('id', '=', beanId).execute();
  await db.deleteFrom('app_users').where('id', '=', appUserId).execute();
  await closeDb();
});

test('getTasteSignals returns saved + high-rated bean attributes', async () => {
  const s = await getTasteSignals(getDb(), appUserId);
  expect(s.savedBeanAttrs.some((a) => a.acidity === 1 && a.roastLevelOrd === 5)).toBe(true);
  expect(s.ratedBeanAttrs.some((a) => a.flavorCategories?.includes('nutty_cocoa'))).toBe(true);
});

test('getTasteSignals with no user returns empty', async () => {
  const s = await getTasteSignals(getDb(), undefined);
  expect(s.savedBeanAttrs).toEqual([]);
  expect(s.ratedBeanAttrs).toEqual([]);
});

test('setGlobalPreference upserts likes/dislikes', async () => {
  const prev = await getGlobalPreference(getDb());
  await setGlobalPreference(getDb(), { likes: ['저산미', '다크 로스팅'], dislikes: ['고산미'] });
  const row = await getGlobalPreference(getDb());
  expect(row?.likes).toEqual(['저산미', '다크 로스팅']);
  expect(row?.dislikes).toEqual(['고산미']);
  // restore
  await setGlobalPreference(getDb(), { likes: prev?.likes ?? [], dislikes: prev?.dislikes ?? [] });
});
```

- [ ] **Step 2: 실패 확인**

Run: `export DATABASE_URL=postgresql:///brewdial_test; pnpm --filter @brewdial/db test -- recommend`
Expected: FAIL — 모듈/함수 없음.

- [ ] **Step 3: setGlobalPreference 추가** — `packages/db/src/repositories/preferences.ts` 끝에 추가

```ts
/**
 * setGlobalPreference — upsert likes/dislikes on the singleton 'global' row.
 * S1: global write (per-user is S4).
 */
export async function setGlobalPreference(
  db: Kysely<DB>,
  input: { likes: string[]; dislikes: string[] }
): Promise<PreferenceRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db.insertInto('preferences') as any)
    .values({ id: 'global', likes: input.likes, dislikes: input.dislikes })
    .onConflict((oc: any) => oc.column('id').doUpdateSet({ likes: input.likes, dislikes: input.dislikes, updated_at: new Date() }))
    .returning(PREFERENCE_COLS)
    .executeTakeFirstOrThrow();
  return row as PreferenceRow;
}
```

- [ ] **Step 4: recommend 리포 작성** — `packages/db/src/repositories/recommend.ts`

```ts
import { sql, type Kysely } from 'kysely';
import type { BeanAttributes } from '@brewdial/shared';
import type { DB } from '../types.js';

const ATTR_COLS = [
  'roast_level_ord', 'agtron_min', 'agtron_max', 'acidity', 'body',
  'decaf', 'flavor_categories', 'attrs_source',
] as const satisfies ReadonlyArray<keyof DB['beans']>;

interface AttrRow {
  roast_level_ord: number | null; agtron_min: number | null; agtron_max: number | null;
  acidity: number | null; body: number | null; decaf: boolean | null;
  flavor_categories: string[] | null; attrs_source: string | null;
}

function toAttrs(r: AttrRow): BeanAttributes {
  const a: BeanAttributes = {};
  if (r.roast_level_ord != null) a.roastLevelOrd = r.roast_level_ord;
  if (r.agtron_min != null) a.agtronMin = r.agtron_min;
  if (r.agtron_max != null) a.agtronMax = r.agtron_max;
  if (r.acidity != null) a.acidity = r.acidity;
  if (r.body != null) a.body = r.body;
  if (r.decaf != null) a.decaf = r.decaf;
  if (r.flavor_categories != null) a.flavorCategories = r.flavor_categories as BeanAttributes['flavorCategories'];
  if (r.attrs_source != null) a.attrsSource = r.attrs_source as BeanAttributes['attrsSource'];
  return a;
}

/**
 * getTasteSignals — read-time taste signals for an app user.
 * savedBeanAttrs: beans the user saved. ratedBeanAttrs: beans of feedback the user
 * gave overall>=4. Returns empty arrays when appUserId is undefined (anon).
 */
export async function getTasteSignals(
  db: Kysely<DB>,
  appUserId?: string
): Promise<{ savedBeanAttrs: BeanAttributes[]; ratedBeanAttrs: BeanAttributes[] }> {
  if (!appUserId) return { savedBeanAttrs: [], ratedBeanAttrs: [] };

  const savedRows = await db
    .selectFrom('saved_beans')
    .innerJoin('beans', 'beans.id', 'saved_beans.bean_id')
    .select(ATTR_COLS.map((c) => `beans.${c}` as `beans.${typeof c}`))
    .where('saved_beans.app_user_id', '=', appUserId)
    .execute() as unknown as AttrRow[];

  const ratedRows = await db
    .selectFrom('feedback')
    .innerJoin('beans', 'beans.id', 'feedback.bean_id')
    .select(ATTR_COLS.map((c) => `beans.${c}` as `beans.${typeof c}`))
    .where('feedback.owner_id', '=', appUserId)
    .where(sql<number>`coalesce((feedback.ratings->>'overall')::int, 0)`, '>=', 4)
    .execute() as unknown as AttrRow[];

  return { savedBeanAttrs: savedRows.map(toAttrs), ratedBeanAttrs: ratedRows.map(toAttrs) };
}
```

> 주의: kysely `select(ATTR_COLS.map(...))` 형태가 타입 추론에서 걸리면, 명시적으로 `.select(['beans.roast_level_ord', 'beans.agtron_min', ...])` 리터럴 배열로 펼쳐 쓴다(테스트 통과가 기준). `owner_id`가 feedback에 있는지는 006 이후 존재(ROB-654) — 확인됨.

- [ ] **Step 5: export 추가** — `packages/db/src/index.ts` 끝에 추가

```ts
export * from './repositories/recommend.js'
```

- [ ] **Step 6: 통과 확인**

Run: `export DATABASE_URL=postgresql:///brewdial_test; pnpm --filter @brewdial/db test -- recommend`
Expected: PASS. (타입 에러 시 select를 리터럴 배열로 펼침.)

- [ ] **Step 7: 커밋**

```bash
git add packages/db/src/repositories/preferences.ts packages/db/src/repositories/recommend.ts packages/db/src/index.ts packages/db/src/recommend.test.ts
git commit -m "feat(db): setGlobalPreference + getTasteSignals (v2 S1)"
```

---

### Task 4: API — GET /api/me/recommendations

**Files:**
- Modify: `apps/api/src/routes/me.ts`
- Test: `apps/api/src/routes/me.recommendations.test.ts`

**Interfaces:**
- Consumes: `getTasteSignals`, `getGlobalPreference`, `listBeans` (from `@brewdial/db`); `deriveTasteTarget`, `scoreBean` (from `@brewdial/shared`).
- Produces: `GET /api/me/recommendations` → `{ tasteProfile, bands: Record<string, BeanScore>, ranked: string[] }`.

- [ ] **Step 1: 실패 테스트 작성** — `apps/api/src/routes/me.recommendations.test.ts`

```ts
import { Hono } from 'hono';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from '@brewdial/db';
import { me } from './me.js';
import { identityMiddleware } from '../middleware/identity.js';

function makeApp() { const app = new Hono(); app.use('/api/*', identityMiddleware); app.route('/api/me', me); return app; }
const app = makeApp();
const SEED = randomUUID().replace(/-/g, '').slice(0, 8);
let beanId: string;

beforeAll(async () => {
  const db = getDb();
  const b = await db.insertInto('beans').values({ name: `RecBean ${SEED}`, roast_level_ord: 5, acidity: 1, body: 4, flavor_categories: ['nutty_cocoa', 'sweet'], attrs_source: 'ai_extracted' }).returning('id').executeTakeFirstOrThrow();
  beanId = b.id;
  // give it an active public recipe so it appears in listBeans (recipe_count>0)
  await db.insertInto('recipes').values({ method: 'v60', title: `RecBean rec ${SEED}`, bean_id: beanId, owner_id: null }).execute();
});
afterAll(async () => {
  const db = getDb();
  await db.deleteFrom('recipes').where('title', 'like', `RecBean rec ${SEED}`).execute();
  await db.deleteFrom('beans').where('id', '=', beanId).execute();
  await closeDb();
});

test('GET /api/me/recommendations without identity → 200 with tasteProfile + bands', async () => {
  const res = await app.request('http://localhost/api/me/recommendations');
  expect(res.status).toBe(200);
  const body: any = await res.json();
  expect(body.tasteProfile).toBeDefined();
  expect(typeof body.tasteProfile.confidence).toBe('string');
  expect(body.bands[beanId]).toBeDefined();
  expect(['great', 'ok', 'adventure', 'unknown']).toContain(body.bands[beanId].band);
  expect(Array.isArray(body.ranked)).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/%/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `export DATABASE_URL=postgresql:///brewdial_test; pnpm --filter @brewdial/api test -- me.recommendations`
Expected: FAIL — 404 (route 없음).

- [ ] **Step 3: 라우트 구현** — `apps/api/src/routes/me.ts`

상단 import 블록 교체:

```ts
import { getDb, saveRecipe, saveBean, upsertGear, upsertCalibration, listBeans, getTasteSignals, getGlobalPreference, setGlobalPreference } from '@brewdial/db'
import { deriveTasteTarget, scoreBean, validateUpdatePreferencesInput, type BeanAttributes } from '@brewdial/shared'
```

`me.get('/collections', ...)` 블록 위에(또는 파일 내 적당한 위치에) 추가:

```ts
// GET /me/recommendations — read-time taste target + per-bean match bands.
// Identity OPTIONAL: uses the caller's saved/rated beans when present, else global only.
me.get('/recommendations', async (c) => {
  const db = getDb()
  const appUserId = c.get('appUserId') as string | undefined
  const [signals, prefs, beans] = await Promise.all([
    getTasteSignals(db, appUserId),
    getGlobalPreference(db),
    listBeans(db),
  ])
  const target = deriveTasteTarget({
    savedBeanAttrs: signals.savedBeanAttrs,
    ratedBeanAttrs: signals.ratedBeanAttrs,
    likes: prefs?.likes ?? [],
    dislikes: prefs?.dislikes ?? [],
  })
  const bands: Record<string, ReturnType<typeof scoreBean>> = {}
  for (const b of beans) {
    if (!b.id) continue
    const attrs: BeanAttributes = {
      roastLevelOrd: b.roast_level_ord ?? undefined,
      agtronMin: b.agtron_min ?? undefined,
      agtronMax: b.agtron_max ?? undefined,
      acidity: b.acidity ?? undefined,
      body: b.body ?? undefined,
      decaf: b.decaf ?? undefined,
      flavorCategories: (b.flavor_categories ?? undefined) as BeanAttributes['flavorCategories'],
      attrsSource: (b.attrs_source ?? undefined) as BeanAttributes['attrsSource'],
    }
    bands[b.id] = scoreBean(attrs, target)
  }
  const rankScore = { great: 3, ok: 2, adventure: 1, unknown: 0 } as const
  const ranked = Object.entries(bands)
    .sort((a, b) => (rankScore[b[1].band] - rankScore[a[1].band]) || (b[1].score - a[1].score))
    .map(([id]) => id)
  return c.json({
    tasteProfile: {
      targets: { acidity: target.acidity, body: target.body, roast: target.roast },
      flavorAffinity: target.flavorAffinity,
      penalize: target.penalize,
      confidence: target.confidence,
      summary: target.summary,
      evidence: target.evidence,
    },
    bands,
    ranked,
  })
})
```

> `listBeans(db)`는 `bean_summaries`에서 속성 컬럼(snake_case)을 반환한다(ROB-654 BEAN_COLS). `BeanRow` 필드명 확인: `roast_level_ord`, `acidity`, `body`, `decaf`, `flavor_categories`, `attrs_source`, `agtron_min/max`.

- [ ] **Step 4: 통과 확인**

Run: `export DATABASE_URL=postgresql:///brewdial_test; pnpm --filter @brewdial/api test -- me.recommendations`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/routes/me.ts apps/api/src/routes/me.recommendations.test.ts
git commit -m "feat(api): GET /api/me/recommendations (server-side scoring) (v2 S1)"
```

---

### Task 5: API — PUT /api/me/preferences

**Files:**
- Modify: `apps/api/src/routes/me.ts`
- Test: `apps/api/src/routes/me.preferences.test.ts`

**Interfaces:**
- Consumes: `setGlobalPreference` (db), `validateUpdatePreferencesInput` (shared) — Task 4에서 이미 import됨.
- Produces: `PUT /api/me/preferences` → `{ likes, dislikes }` (updated row) / 400.

- [ ] **Step 1: 실패 테스트 작성** — `apps/api/src/routes/me.preferences.test.ts`

```ts
import { Hono } from 'hono';
import { afterAll, expect, test } from 'vitest';
import { getDb, closeDb, getGlobalPreference, setGlobalPreference } from '@brewdial/db';
import { me } from './me.js';
import { identityMiddleware } from '../middleware/identity.js';

function makeApp() { const app = new Hono(); app.use('/api/*', identityMiddleware); app.route('/api/me', me); return app; }
const app = makeApp();

afterAll(async () => { await closeDb(); });

test('PUT /api/me/preferences with whitelisted tags → 200, persisted', async () => {
  const prev = await getGlobalPreference(getDb());
  const res = await app.request('http://localhost/api/me/preferences', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ likes: ['저산미', '다크 로스팅'], dislikes: ['고산미'] }),
  });
  expect(res.status).toBe(200);
  const row = await getGlobalPreference(getDb());
  expect(row?.likes).toEqual(['저산미', '다크 로스팅']);
  await setGlobalPreference(getDb(), { likes: prev?.likes ?? [], dislikes: prev?.dislikes ?? [] });
});

test('PUT /api/me/preferences with unknown tag → 400', async () => {
  const res = await app.request('http://localhost/api/me/preferences', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ likes: ['초코비'] }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: 실패 확인**

Run: `export DATABASE_URL=postgresql:///brewdial_test; pnpm --filter @brewdial/api test -- me.preferences`
Expected: FAIL — 404.

- [ ] **Step 3: 라우트 구현** — `apps/api/src/routes/me.ts`, recommendations 블록 아래에 추가

```ts
// PUT /me/preferences — edit the global taste tags (S1 global singleton).
me.put('/preferences', async (c) => {
  const body = await c.req.json().catch(() => null)
  const result = validateUpdatePreferencesInput(body)
  if (!result.ok) return c.json({ error: 'validation failed', details: result.errors }, 400)
  const row = await setGlobalPreference(getDb(), result.value)
  return c.json({ likes: row.likes, dislikes: row.dislikes })
})
```

- [ ] **Step 4: 통과 확인**

Run: `export DATABASE_URL=postgresql:///brewdial_test; pnpm --filter @brewdial/api test -- me.preferences`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/routes/me.ts apps/api/src/routes/me.preferences.test.ts
git commit -m "feat(api): PUT /api/me/preferences taste correction (v2 S1)"
```

---

### Task 6: miniapp — 추천 데이터 레이어

**Files:**
- Create: `apps/miniapp/src/lib/data/recommend.ts`

**Interfaces:**
- Consumes: `apiGet`/`apiSend` (`../api`), `resolveIdentity` (`../identity`).
- Produces: `type MatchBand`, `interface AxisComparison`, `interface BeanScore`, `interface RecommendationsResponse`, `fetchRecommendations(): Promise<RecommendationsResponse>`, `updatePreferences(likes, dislikes): Promise<{likes:string[];dislikes:string[]}>`.

- [ ] **Step 1: 데이터 레이어 작성** — `apps/miniapp/src/lib/data/recommend.ts`

```ts
import { apiGet, apiSend } from '../api';
import { resolveIdentity } from '../identity';

export type MatchBand = 'great' | 'ok' | 'adventure' | 'unknown';
export interface AxisComparison { key: string; label: string; value: number | string; target?: number | string; match: 'hit' | 'near' | 'miss' | 'na'; }
export interface BeanScore { band: MatchBand; score: number; axes: AxisComparison[]; why: string; }
export interface TasteProfile {
  targets: { acidity?: number; body?: number; roast?: number };
  flavorAffinity: string[]; penalize: string[];
  confidence: 'none' | 'low' | 'medium' | 'high';
  summary: string; evidence: string[];
}
export interface RecommendationsResponse {
  tasteProfile: TasteProfile;
  bands: Record<string, BeanScore>;
  ranked: string[];
}

export async function fetchRecommendations(): Promise<RecommendationsResponse> {
  const identity = await resolveIdentity();
  return apiGet<RecommendationsResponse>('/me/recommendations', { identity });
}

export async function updatePreferences(likes: string[], dislikes: string[]): Promise<{ likes: string[]; dislikes: string[] }> {
  const identity = await resolveIdentity();
  return apiSend<{ likes: string[]; dislikes: string[] }>('PUT', '/me/preferences', { likes, dislikes }, { identity });
}
```

> 확인: `resolveIdentity`가 `apps/miniapp/src/lib/identity.ts`에서 export되는지(기존 user-content.ts가 사용). 경로가 `../identity`가 맞는지 확인 후 조정. API 경로 프리픽스(`/me/...` vs `/api/me/...`)는 기존 data 모듈 관례를 따른다(현 코드가 `/beans`를 쓰므로 `/me/...`).

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter @brewdial/miniapp check`
Expected: PASS (에러 없음).

- [ ] **Step 3: 커밋**

```bash
git add apps/miniapp/src/lib/data/recommend.ts
git commit -m "feat(miniapp): recommendations data layer (v2 S1)"
```

---

### Task 7: miniapp — BeanCard 밴드 배지 + Beans 홈 배선

**Files:**
- Modify: `apps/miniapp/src/components/BeanCard.tsx`
- Modify: `apps/miniapp/src/pages/Beans.tsx`

**Interfaces:**
- Consumes: `BeanScore`, `fetchRecommendations` (`../lib/data/recommend`).

- [ ] **Step 1: BeanCard에 밴드 배지 추가** — `apps/miniapp/src/components/BeanCard.tsx` 전체 교체

```tsx
import type { BeanSummary } from '../lib/data/beans';
import type { MatchBand } from '../lib/data/recommend';

const BAND_LABEL: Record<MatchBand, string> = { great: '잘 맞음', ok: '무난', adventure: '모험', unknown: '정보 없음' };

export default function BeanCard({ bean, band }: { bean: BeanSummary; band?: MatchBand }) {
  const meta = [bean.roaster, bean.origin, bean.process, bean.roastLevel].filter(Boolean).join(' · ');
  return (
    <a className="card" href={`#/beans/${encodeURIComponent(bean.id)}`}>
      <p className="card-title">
        {bean.name}
        {bean.hasAi && <span className="badge-ai" style={{ marginLeft: 6 }}>✨ AI</span>}
        {band && <span className={`band band-${band}`} style={{ marginLeft: 6 }}>{BAND_LABEL[band]}</span>}
      </p>
      {meta && <p className="card-meta muted">{meta}</p>}
      <p className="card-meta muted">레시피 {bean.recipeCount}개</p>
    </a>
  );
}
```

- [ ] **Step 2: 밴드 배지 스타일 추가** — miniapp 전역 CSS(예: `apps/miniapp/src/index.css` 또는 기존 스타일 파일; `.badge-ai`가 정의된 곳)에 추가

```css
.band { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.band-great { background: #dcfce7; color: #166534; }
.band-ok { background: #fef3c7; color: #92400e; }
.band-adventure { background: #f3f4f6; color: #6b7280; }
.band-unknown { background: #f3f4f6; color: #9ca3af; }
```

> `.badge-ai` 정의 위치를 `grep -rn "badge-ai" apps/miniapp/src` 로 찾아 같은 파일에 추가.

- [ ] **Step 3: Beans 홈에서 추천 로드 + 전달** — `apps/miniapp/src/pages/Beans.tsx`

import에 추가:
```tsx
import { fetchRecommendations, type RecommendationsResponse } from '../lib/data/recommend';
```
상태 추가(다른 useState 옆):
```tsx
const [recs, setRecs] = useState<RecommendationsResponse | null>(null);
```
effect 추가(기존 effect들 아래):
```tsx
useEffect(() => {
  fetchRecommendations().then(setRecs).catch(() => { /* 추천 없으면 배지 생략 */ });
}, []);
```
BeanCard 렌더 2곳(`저장한 원두` 섹션, `원두` 섹션)에서 `band` 전달:
```tsx
<BeanCard key={b.id} bean={b} band={recs?.bands[b.id]?.band} />
```
(저장 섹션도 동일하게 `band={recs?.bands[b.id]?.band}` 추가.)

- [ ] **Step 4: 타입체크**

Run: `pnpm --filter @brewdial/miniapp check`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/miniapp/src/components/BeanCard.tsx apps/miniapp/src/pages/Beans.tsx apps/miniapp/src/index.css
git commit -m "feat(miniapp): BeanCard match-band badge + Beans home wiring (v2 S1)"
```

---

### Task 8: miniapp — 취향 요약 카드(교정) + BeanDetail 축 스트립

**Files:**
- Modify: `apps/miniapp/src/pages/Beans.tsx`
- Modify: `apps/miniapp/src/pages/BeanDetail.tsx`
- Create: `apps/miniapp/src/components/TasteCard.tsx`

**Interfaces:**
- Consumes: `RecommendationsResponse`, `updatePreferences`, `TASTE_TAGS` (`@brewdial/shared`), `BeanScore`.

- [ ] **Step 1: TasteCard 컴포넌트** — `apps/miniapp/src/components/TasteCard.tsx`

```tsx
import { useState } from 'react';
import { TASTE_TAGS } from '@brewdial/shared';
import type { TasteProfile } from '../lib/data/recommend';
import { updatePreferences } from '../lib/data/recommend';

export default function TasteCard({ profile, onChanged }: { profile: TasteProfile; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [likes, setLikes] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  if (profile.confidence === 'none') {
    return <div className="taste-card"><p className="muted">원두를 저장하거나 취향을 알려주면 딱 맞는 원두를 표시해요.</p>
      <button className="btn-mini" onClick={() => setEditing(true)}>취향 설정</button>
      {editing && <TagEditor likes={likes} dislikes={dislikes} setLikes={setLikes} setDislikes={setDislikes} saving={saving} onSave={save} />}</div>;
  }
  async function save() { setSaving(true); try { await updatePreferences(likes, dislikes); setEditing(false); onChanged(); } finally { setSaving(false); } }
  return (
    <div className="taste-card">
      <div className="label">☕ 당신의 취향</div>
      <div className="taste-summary">{profile.summary}</div>
      {profile.evidence.length > 0 && <div className="muted taste-evidence">{profile.evidence.join(' · ')}</div>}
      {!editing ? (
        <div className="taste-ask">이게 맞나요? <button className="btn-mini" onClick={onChanged}>👍</button> <button className="btn-mini" onClick={() => setEditing(true)}>✏️ 수정</button></div>
      ) : (
        <TagEditor likes={likes} dislikes={dislikes} setLikes={setLikes} setDislikes={setDislikes} saving={saving} onSave={save} />
      )}
    </div>
  );
}

function TagEditor(props: { likes: string[]; dislikes: string[]; setLikes: (v: string[]) => void; setDislikes: (v: string[]) => void; saving: boolean; onSave: () => void }) {
  const toggle = (arr: string[], set: (v: string[]) => void, tag: string) => set(arr.includes(tag) ? arr.filter((t) => t !== tag) : [...arr, tag]);
  return (
    <div className="tag-editor">
      <div className="muted">좋아하는 특성</div>
      <div className="chips">{TASTE_TAGS.map((t) => <button key={`l-${t}`} className={`chip ${props.likes.includes(t) ? 'chip-on' : ''}`} onClick={() => toggle(props.likes, props.setLikes, t)}>{t}</button>)}</div>
      <div className="muted">피하고 싶은 특성</div>
      <div className="chips">{TASTE_TAGS.map((t) => <button key={`d-${t}`} className={`chip ${props.dislikes.includes(t) ? 'chip-off' : ''}`} onClick={() => toggle(props.dislikes, props.setDislikes, t)}>{t}</button>)}</div>
      <button className="btn-mini" disabled={props.saving} onClick={props.onSave}>{props.saving ? '저장 중…' : '저장'}</button>
    </div>
  );
}
```

- [ ] **Step 2: Beans 홈 상단에 TasteCard** — `apps/miniapp/src/pages/Beans.tsx`

import 추가: `import TasteCard from '../components/TasteCard';`
`<div className="screen screen-tabpage">` 바로 안, `저장한 원두` 섹션 위에:
```tsx
{recs && <TasteCard profile={recs.tasteProfile} onChanged={() => fetchRecommendations().then(setRecs).catch(() => {})} />}
```

- [ ] **Step 3: BeanDetail 축 스트립** — `apps/miniapp/src/pages/BeanDetail.tsx`

BeanDetail이 이미 원두 상세를 로드하므로, 추천도 로드해 해당 원두의 `bands[id]`를 스트립으로 렌더. import: `import { fetchRecommendations, type BeanScore } from '../lib/data/recommend';` 상태+effect로 `score` 로드 후:
```tsx
{score && score.band !== 'unknown' && (
  <div className="axis-strip">
    <span className={`band band-${score.band}`}>{{great:'잘 맞음',ok:'무난',adventure:'모험',unknown:''}[score.band]}</span>
    {score.axes.map((a) => (
      <span key={a.key} className={`axis axis-${a.match}`}>{a.label} {a.value}{a.target != null ? ` (타깃 ${a.target})` : ''} {a.match === 'hit' ? '✓' : a.match === 'miss' ? '✗' : ''}</span>
    ))}
    <p className="muted">{score.why}</p>
  </div>
)}
```
(BeanDetail의 기존 로드 패턴에 맞춰 `useEffect(()=>{ fetchRecommendations().then(r=>setScore(r.bands[id] ?? null)).catch(()=>{}); },[id]);` 추가.)

- [ ] **Step 4: 스타일 추가** — 전역 CSS(Task 7과 동일 파일)

```css
.taste-card { margin: 10px 0; padding: 12px 14px; border-radius: 14px; background: linear-gradient(135deg,#fff7ed,#fef2f2); border: 1px solid #fde4d3; }
.taste-card .label { font-size: 11px; font-weight: 700; color: #9a3412; }
.taste-summary { font-weight: 700; margin-top: 4px; }
.taste-evidence { font-size: 12px; margin-top: 4px; }
.taste-ask { margin-top: 10px; font-size: 13px; }
.btn-mini { border: 1px solid #d4d4d8; background: #fff; border-radius: 8px; padding: 2px 10px; font-size: 13px; margin-left: 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.chip { border: 1px solid #e5e7eb; background: #fff; border-radius: 999px; padding: 3px 10px; font-size: 12px; }
.chip-on { background: #dcfce7; border-color: #bbf7d0; color: #166534; }
.chip-off { background: #fee2e2; border-color: #fecaca; color: #991b1b; }
.axis-strip { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; }
.axis { font-size: 12px; padding: 2px 8px; border-radius: 8px; background: #f8fafc; border: 1px solid #eef2f7; color: #475569; }
.axis-hit { color: #166534; border-color: #bbf7d0; background: #f0fdf4; }
.axis-miss { color: #9ca3af; }
```

- [ ] **Step 5: 타입체크 + 전체 그린**

```bash
pnpm --filter @brewdial/miniapp check
export DATABASE_URL=postgresql:///brewdial_test
pnpm -r build
pnpm --filter @brewdial/shared test && pnpm --filter @brewdial/db test && pnpm --filter @brewdial/api test
```
Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/miniapp/src/pages/Beans.tsx apps/miniapp/src/pages/BeanDetail.tsx apps/miniapp/src/components/TasteCard.tsx apps/miniapp/src/index.css
git commit -m "feat(miniapp): taste summary card (correction) + BeanDetail axis strip (v2 S1)"
```

---

## 마무리 (플랜 완료 후)

- 전체 검증: `pnpm -r check && pnpm -r build` + shared/db/api 테스트 그린.
- 실 시각 폴리시는 `frontend-design` 스킬로 별도 패스(선택).
- 배포: 마이그레이션 없음 → API rsync+build(shared/db/api)+restart(deploy/oci), miniapp은 Cloudflare Worker 자동 빌드(+토스 .ait 재제출은 클라 변경분).
- 후속 슬라이스: S2(링크 붙여넣기), S3(2-슬롯), S4(per-user preferences).
