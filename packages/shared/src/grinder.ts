// ROB-611: grinder registry + grind conversion helper (app/server shared).
// The robust cross-grinder anchor is the RELATIVE position within each grinder's
// brew-method click band (NOT absolute microns, which are unreliable). Given a
// recipe's grind (with one or more measured per-grinder clicks) and a target
// grinder, suggest a dial-in START — never an exact answer.

import type { GrindSpec } from './types.js';

export interface GrinderBand {
  from: number;
  to: number;
}

export interface GrinderInfo {
  id?: string;
  name: string;
  umPerClickEst?: number; // ADVISORY only — absolute microns are unreliable
  umPerClickSource?: 'measured' | 'estimated' | 'unknown';
  zeroRef?: string;
  stepless: boolean;
  brewMethodRanges: Record<string, GrinderBand>; // e.g. { v60: { from: 90, to: 108 } }
  notes?: string;
}

export type SuggestionBasis = 'measured' | 'relative-band' | 'band-midpoint' | 'none';

export interface ClickSuggestion {
  grinder: string;
  clicks: number | null; // suggested start (rounded); null when undeterminable
  range?: GrinderBand; // suggested band around the start (when interpolated/banded)
  source: 'measured' | 'dial-in-start' | 'unknown';
  basis: SuggestionBasis;
  disclaimer: string;
}

export const DIAL_IN_DISCLAIMER =
  '정답이 아니라 dial-in 시작점이에요. 드로다운 시간과 맛으로 ±1~2클릭 보정하세요.';

// Parse a clicks value (number, "25-28", "1.5 rev"). Range strings average; null if none.
export function parseClicks(v: number | string | undefined | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const nums = v.match(/\d+(\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const parsed = nums.map(Number).filter((n) => Number.isFinite(n));
  if (parsed.length === 0) return null;
  return parsed.reduce((a, b) => a + b, 0) / parsed.length;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// Suggest dial-in clicks for `toGrinder` from a recipe's grind spec.
//   method: the brew method key (e.g. 'v60') used to look up each grinder's band.
//   registry: known grinders (to resolve a measured reference grinder's band).
export function suggestGrinderClicks(
  grind: GrindSpec,
  method: string,
  toGrinder: GrinderInfo,
  registry: GrinderInfo[]
): ClickSuggestion {
  const m = norm(method);

  // 1) Measured pass-through: the recipe already lists clicks for THIS grinder.
  const direct = grind.perGrinder?.find((p) => norm(p.grinder) === norm(toGrinder.name));
  if (direct) {
    return {
      grinder: toGrinder.name,
      clicks: parseClicks(direct.clicks),
      source: direct.source,
      basis: 'measured',
      disclaimer: direct.source === 'measured' ? '' : DIAL_IN_DISCLAIMER
    };
  }

  const toBand = toGrinder.brewMethodRanges[m];

  // 2) Relative-band interpolation from a measured reference grinder. Keeps the
  //    extraction position (relative coarseness within each grinder's band) fixed.
  if (toBand && toBand.to !== toBand.from && grind.perGrinder) {
    for (const ref of grind.perGrinder) {
      const refInfo = registry.find((g) => norm(g.name) === norm(ref.grinder));
      const refBand = refInfo?.brewMethodRanges[m];
      const refClicks = parseClicks(ref.clicks);
      if (refBand && refBand.to !== refBand.from && refClicks != null) {
        const pos = clamp((refClicks - refBand.from) / (refBand.to - refBand.from), 0, 1);
        const start = Math.round(toBand.from + pos * (toBand.to - toBand.from));
        return {
          grinder: toGrinder.name,
          clicks: start,
          range: { from: Math.max(toBand.from, start - 2), to: Math.min(toBand.to, start + 2) },
          source: 'dial-in-start',
          basis: 'relative-band',
          disclaimer: DIAL_IN_DISCLAIMER
        };
      }
    }
  }

  // 3) Band midpoint: we know the target intent + this grinder's band, but have
  //    no usable measured reference to interpolate from.
  if (toBand && (grind.target.brewMethodPosition || grind.target.targetDrawdownSec !== undefined)) {
    const mid = Math.round((toBand.from + toBand.to) / 2);
    return {
      grinder: toGrinder.name,
      clicks: mid,
      range: toBand,
      source: 'dial-in-start',
      basis: 'band-midpoint',
      disclaimer: DIAL_IN_DISCLAIMER
    };
  }

  // 4) Undeterminable — show the target intent text instead (caller decides).
  return {
    grinder: toGrinder.name,
    clicks: null,
    source: 'unknown',
    basis: 'none',
    disclaimer: DIAL_IN_DISCLAIMER
  };
}
