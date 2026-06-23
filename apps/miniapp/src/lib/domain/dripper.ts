// Vendored from packages/shared/src/dripper.ts (source of truth). Re-sync if it changes.
// ROB-612: dripper registry + adaptation helper. Flow restriction is modeled on a
// continuum (0 = fast/bed-controlled .. 1 = slow/dripper-controlled); guidance is
// DIRECTIONAL only (anchors fixed; grind/pour move by direction, confirmed by drawdown).

import type { Confidence, DripperClass, GrindShift, PourShift } from './types';

export interface DripperSizeModel {
  model: string;
  maxDoseG?: number;
  bedDepthFactor?: number;
}

export interface DripperInfo {
  id?: string;
  name: string;
  class: DripperClass;
  geometry?: string;
  continuumPosition?: number; // 0 fast/bed-controlled .. 1 slow/dripper-controlled
  filterType?: string;
  recommendedDoseRange?: { minG?: number; maxG?: number };
  sizeModels?: DripperSizeModel[];
  notes?: string;
}

export interface DripperAdaptation {
  dripper: string;
  dripperId?: string;
  class: DripperClass;
  sizeMatch: 'ok' | 'undersized' | 'oversized';
  bedDepthShift: 'shallower' | 'deeper' | 'similar';
  bedOverflow: boolean;
  grindShift: GrindShift; // DIRECTION only; confirm with drawdown
  pourShift: PourShift;
  confidence: Confidence;
  warn?: string;
  note?: string;
  disclaimer: string;
}

export const DRIPPER_DISCLAIMER =
  '드리퍼 이식은 단일 숫자 매핑이 불가능해요. 비율·온도·목표 시간은 고정하고, 분쇄·푸어는 방향만 잡은 뒤 드로다운/맛으로 확정하세요.';

function classPos(cls: DripperClass, explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit)) return explicit;
  switch (cls) {
    case 'bed_restricted':
      return 0.1;
    case 'hybrid':
      return 0.35;
    case 'immersion':
      return 0.6;
    case 'dripper_restricted':
      return 0.85;
    default:
      return 0.5;
  }
}

const DELTA_THRESHOLD = 0.2;

export function suggestDripperAdaptation(
  origin: DripperInfo,
  doseG: number | undefined,
  target: DripperInfo
): DripperAdaptation {
  const delta = classPos(target.class, target.continuumPosition) - classPos(origin.class, origin.continuumPosition);

  let grindShift: GrindShift = 'none';
  let pourShift: PourShift = 'none';
  if (delta > DELTA_THRESHOLD) {
    grindShift = 'coarser';
    pourShift = 'fewer_pours';
  } else if (delta < -DELTA_THRESHOLD) {
    grindShift = 'finer';
    pourShift = 'more_pours';
  }

  const minG = target.recommendedDoseRange?.minG;
  const maxG = target.recommendedDoseRange?.maxG;
  let sizeMatch: DripperAdaptation['sizeMatch'] = 'ok';
  let bedDepthShift: DripperAdaptation['bedDepthShift'] = 'similar';
  let bedOverflow = false;
  let warn: string | undefined;
  if (doseG != null) {
    if (maxG != null && doseG > maxG) {
      sizeMatch = 'oversized';
      bedDepthShift = 'deeper';
      bedOverflow = true;
      warn = `도즈 ${doseG}g가 ${target.name} 권장 최대 ${maxG}g를 초과해요. 베드가 깊어져 다시 막힐 수 있으니, 더 큰 사이즈를 쓰거나 베드 깊이를 원본과 비슷하게 맞춘 뒤 적용하세요.`;
    } else if (minG != null && doseG < minG) {
      sizeMatch = 'undersized';
      bedDepthShift = 'shallower';
    }
  }

  let confidence: Confidence = 'medium';
  if (bedOverflow) confidence = 'low';
  else if (target.class === origin.class && sizeMatch === 'ok') confidence = 'high';

  const out: DripperAdaptation = {
    dripper: target.name,
    class: target.class,
    sizeMatch,
    bedDepthShift,
    bedOverflow,
    grindShift,
    pourShift,
    confidence,
    disclaimer: DRIPPER_DISCLAIMER
  };
  if (target.id) out.dripperId = target.id;
  if (warn) out.warn = warn;
  if (target.notes) out.note = target.notes;
  return out;
}
