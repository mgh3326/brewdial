import type { BrewMethod, RecipeStep } from './domain';

// "추출 방식"이라기보다 드리퍼/기구라서 표시명을 분리해 둔다.
export const METHOD_LABELS: Record<BrewMethod, string> = {
  v60: 'V60',
  kalita: '칼리타',
  aeropress: '에어로프레스',
  espresso: '에스프레소',
  other: '기타',
};

// 자동 푸어 스케줄을 만들 수 있는(=뜸+여러 푸어) 푸어오버 기구.
const POUR_OVER: ReadonlySet<BrewMethod> = new Set<BrewMethod>(['v60', 'kalita', 'aeropress']);
export function isPourOverMethod(m: BrewMethod): boolean {
  return POUR_OVER.has(m);
}

export type PourPreset = 'even' | 'kasuya46';
export const POUR_PRESETS: { key: PourPreset; label: string }[] = [
  { key: 'even', label: '균등 푸어' },
  { key: 'kasuya46', label: '카수야 4:6' },
];

const round5 = (n: number) => Math.round(n / 5) * 5;

// dose + 총 물량(g) + 프리셋 → 타이머용 푸어 스텝(누적 waterG, 쉬는 시간 포함).
export function generatePourSteps(
  doseG: number,
  totalWaterG: number,
  preset: PourPreset
): RecipeStep[] {
  if (!(doseG > 0) || !(totalWaterG > 0)) return [];

  // Raw plan: pour start time + pre-clamp cumulative target.
  const plan: { startSec: number; durSec: number; rawTarget: number; bloom: boolean }[] = [];
  if (preset === 'kasuya46') {
    // 4:6 — 45초 간격 5번 푸어, 첫 푸어가 뜸 역할.
    const per = totalWaterG / 5;
    for (let i = 0; i < 5; i += 1) {
      plan.push({
        startSec: i * 45,
        durSec: 20,
        rawTarget: i === 4 ? totalWaterG : round5((i + 1) * per),
        bloom: i === 0,
      });
    }
  } else {
    // even — 뜸(원두 2.5배) + 3번 균등 푸어.
    const bloom = Math.min(round5(doseG * 2.5), totalWaterG);
    const remain = totalWaterG - bloom;
    const pours = 3;
    plan.push({ startSec: 0, durSec: 12, rawTarget: bloom, bloom: true });
    for (let i = 1; i <= pours; i += 1) {
      plan.push({
        startSec: 45 + (i - 1) * 45,
        durSec: 20,
        rawTarget: i === pours ? totalWaterG : round5(bloom + (remain / pours) * i),
        bloom: false,
      });
    }
  }

  // Clamp each cumulative target to [prev, total] (monotonic, never over total),
  // drop pours that would add no water, and force the last step to reach total.
  // Guarantees the generated schedule always passes validateCreateRecipeInput.
  const steps: RecipeStep[] = [];
  let prev = 0;
  let pourNo = 0;
  for (let i = 0; i < plan.length; i += 1) {
    const p = plan[i];
    const isLast = i === plan.length - 1;
    const target = isLast ? totalWaterG : Math.min(Math.max(p.rawTarget, prev), totalWaterG);
    if (!p.bloom && target <= prev) {
      if (!isLast) continue; // phantom pour → skip
      if (steps.length > 0) break; // duplicate final target → drop it
    }
    prev = target;
    pourNo += p.bloom ? 0 : 1;
    steps.push({
      atSec: p.startSec,
      endSec: p.startSec + p.durSec,
      waterG: target,
      note: p.bloom
        ? `뜸 들이기: ${target}g까지 골고루 적셔요`
        : `${pourNo}차 푸어: ${target}g까지 부어요`,
    });
  }
  return steps;
}

export function suggestTargetTimeSec(steps: RecipeStep[]): number | undefined {
  if (steps.length === 0) return undefined;
  const lastEnd = Math.max(...steps.map((s) => s.endSec ?? s.atSec ?? 0));
  return lastEnd + 35; // 마지막 푸어 뒤 드로다운 여유
}

// "1:16" 또는 "16" 에서 비율 숫자를 뽑는다. Anchored so garbled/inverted input
// ("16:1", "v60 1:15", "1:16:2") is rejected instead of mis-parsed.
export function parseRatio(input: string): number | undefined {
  const m = /^(?:1\s*:\s*)?(\d+(?:\.\d+)?)$/.exec(input.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
