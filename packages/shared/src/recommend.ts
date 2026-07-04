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
