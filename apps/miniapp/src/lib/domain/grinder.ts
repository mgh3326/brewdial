// Vendored from packages/shared/src/grinder.ts (source of truth). Re-sync if it changes.
// ROB-611: grinder registry + grind conversion helper. Robust cross-grinder anchor is
// the RELATIVE position within each grinder's brew-method click band (not absolute microns).

import type { GrindSpec } from './types';

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

export type SuggestionBasis = 'measured' | 'calibrated' | 'relative-band' | 'band-midpoint' | 'none';

// ROB-611 (Slice D): a user's one-time grinder-pair calibration. A sample records
// "on grinder FROM at fromClicks, my grinder TO actually wanted toClicks" — used to
// shift the band prediction by the measured delta for that pair.
export interface CalibrationSample {
  fromClicks: number;
  toClicks: number;
}
export interface Calibration {
  fromGrinder: string;
  toGrinder: string;
  anchorMethod?: string;
  samples: CalibrationSample[];
}

export interface ClickSuggestion {
  grinder: string;
  clicks: number | null; // suggested start (rounded); null when undeterminable
  range?: GrinderBand; // suggested band around the start (when interpolated/banded)
  source: 'measured' | 'dial-in-start' | 'unknown';
  basis: SuggestionBasis;
  // The reference grinder this suggestion interpolated from (relative-band/calibrated).
  // Calibration must be keyed on THIS, not the recipe's first measured entry.
  fromGrinder?: string;
  fromClicks?: number;
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

// Relative-band map: keep the same coarseness position within each grinder's band.
function bandInterp(fromClicks: number, fromBand: GrinderBand, toBand: GrinderBand): number {
  const pos = clamp((fromClicks - fromBand.from) / (fromBand.to - fromBand.from), 0, 1);
  return toBand.from + pos * (toBand.to - toBand.from);
}

// Suggest dial-in clicks for `toGrinder` from a recipe's grind spec.
//   method: the brew method key (e.g. 'v60') used to look up each grinder's band.
//   registry: known grinders (to resolve a measured reference grinder's band).
export function suggestGrinderClicks(
  grind: GrindSpec,
  method: string,
  toGrinder: GrinderInfo,
  registry: GrinderInfo[],
  calibrations: Calibration[] = []
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

  // 2) Relative-band interpolation from a measured reference grinder, optionally
  //    corrected by the user's one-time pair calibration (ROB-611 Slice D).
  if (toBand && toBand.to !== toBand.from && grind.perGrinder) {
    for (const ref of grind.perGrinder) {
      const refInfo = registry.find((g) => norm(g.name) === norm(ref.grinder));
      const refBand = refInfo?.brewMethodRanges[m];
      const refClicks = parseClicks(ref.clicks);
      if (refBand && refBand.to !== refBand.from && refClicks != null) {
        let predicted = bandInterp(refClicks, refBand, toBand);
        let basis: SuggestionBasis = 'relative-band';
        const cal = calibrations.find(
          (c) =>
            norm(c.fromGrinder) === norm(ref.grinder) &&
            norm(c.toGrinder) === norm(toGrinder.name) &&
            (!c.anchorMethod || norm(c.anchorMethod) === m) &&
            c.samples.length > 0
        );
        if (cal) {
          // One-time pair offset: shift the band prediction by the user's measured
          // delta at their sample point.
          const s = cal.samples[0];
          predicted += s.toClicks - bandInterp(s.fromClicks, refBand, toBand);
          basis = 'calibrated';
        }
        const start = Math.round(predicted);
        return {
          grinder: toGrinder.name,
          clicks: start,
          range: { from: Math.max(0, start - 2), to: start + 2 },
          source: 'dial-in-start',
          basis,
          fromGrinder: ref.grinder,
          fromClicks: refClicks,
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
