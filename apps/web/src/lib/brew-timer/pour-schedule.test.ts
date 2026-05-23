import { describe, expect, it } from 'vitest';
import {
  buildPourSchedule,
  buildBrewPhases,
  formatSeconds,
  getCurrentPhase,
  getCurrentBrewPhase,
  getExpectedWaterG,
  getExpectedWaterGForPhase,
  getBrewPhaseProgressRatio,
  isBrewPhaseResting,
  getPhaseProgressRatio,
  getPhaseStartWaterG,
  phaseRateGPerSec,
  roundToStep,
  type BrewPhase
} from './pour-schedule';
import type { RecipeDoc, RecipeStep } from '@brewdial/shared';

function recipe(overrides: Partial<RecipeDoc> = {}): RecipeDoc {
  return {
    _id: 'recipe:COF-0003',
    type: 'recipe',
    code: 'COF-0003',
    method: 'v60',
    version: 1,
    title: 'Timer test',
    params: { targetTimeSec: 270 },
    steps: [
      { atSec: 0, waterG: 80, note: 'Bloom' },
      { atSec: 45, waterG: 230, note: 'First pour' },
      { atSec: 105, waterG: 380, note: 'Second pour' },
      { atSec: 165, waterG: 500, note: 'Third pour' },
      { atSec: 220, waterG: 620, note: 'Final pour' }
    ],
    createdBy: 'agent',
    createdAt: '2026-04-27T00:00:00.000Z',
    updatedAt: '2026-04-27T00:00:00.000Z',
    ...overrides
  };
}

describe('formatSeconds', () => {
  it('formats elapsed seconds as m:ss', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(45)).toBe('0:45');
    expect(formatSeconds(105)).toBe('1:45');
    expect(formatSeconds(270)).toBe('4:30');
  });
});

describe('buildPourSchedule', () => {
  it('turns recipe steps into start/end timer phases with target water weights', () => {
    const schedule = buildPourSchedule(recipe());
    expect(schedule.totalSec).toBe(270);
    expect(schedule.phases).toEqual([
      { index: 0, startSec: 0, endSec: 45, startLabel: '0:00', endLabel: '0:45', targetWaterG: 80, note: 'Bloom' },
      { index: 1, startSec: 45, endSec: 105, startLabel: '0:45', endLabel: '1:45', targetWaterG: 230, note: 'First pour' },
      { index: 2, startSec: 105, endSec: 165, startLabel: '1:45', endLabel: '2:45', targetWaterG: 380, note: 'Second pour' },
      { index: 3, startSec: 165, endSec: 220, startLabel: '2:45', endLabel: '3:40', targetWaterG: 500, note: 'Third pour' },
      { index: 4, startSec: 220, endSec: 270, startLabel: '3:40', endLabel: '4:30', targetWaterG: 620, note: 'Final pour' }
    ]);
  });

  it('falls back to the last step time when target time is missing', () => {
    const schedule = buildPourSchedule(recipe({ params: {} }));
    expect(schedule.totalSec).toBe(220);
    expect(schedule.phases.at(-1)?.endSec).toBe(220);
  });

  it('uses final step endSec for totalSec when target time is missing', () => {
    const schedule = buildPourSchedule(recipe({
      params: {},
      steps: [
        { atSec: 0, endSec: 30, waterG: 60, note: 'Bloom' },
        { atSec: 60, endSec: 90, waterG: 200, note: 'Pour' }
      ]
    }));
    expect(schedule.totalSec).toBe(90);
    expect(schedule.phases.at(-1)?.endSec).toBe(90);
  });

  it('ignores untimed steps for timer phases', () => {
    const schedule = buildPourSchedule(recipe({
      steps: [
        { note: 'Prep filter' },
        { atSec: 0, waterG: 40, note: 'Bloom' },
        { atSec: 30, waterG: 160, note: 'Pour' }
      ],
      params: { targetTimeSec: 120 }
    }));
    expect(schedule.phases.map(p => p.note)).toEqual(['Bloom', 'Pour']);
  });
});

describe('roundToStep', () => {
  it('rounds to the nearest 10g by default', () => {
    expect(roundToStep(0)).toBe(0);
    expect(roundToStep(40)).toBe(40);
    expect(roundToStep(53.3)).toBe(50);
    expect(roundToStep(57)).toBe(60);
    expect(roundToStep(155)).toBe(160);
  });

  it('respects a custom step', () => {
    expect(roundToStep(157, 5)).toBe(155);
    expect(roundToStep(158, 5)).toBe(160);
    expect(roundToStep(40, 1)).toBe(40);
  });

  it('clamps invalid input to 0 and falls back stepG to 1', () => {
    expect(roundToStep(Number.NaN)).toBe(0);
    expect(roundToStep(-3)).toBe(0);
    expect(roundToStep(53.3, 0)).toBe(53);
    expect(roundToStep(53.3, Number.NaN)).toBe(53);
  });
});

describe('getPhaseStartWaterG', () => {
  const schedule = buildPourSchedule(recipe());

  it('returns 0 for the first phase', () => {
    expect(getPhaseStartWaterG(schedule, 0)).toBe(0);
  });

  it('returns the previous phase cumulative target for later phases', () => {
    expect(getPhaseStartWaterG(schedule, 1)).toBe(80);
    expect(getPhaseStartWaterG(schedule, 2)).toBe(230);
    expect(getPhaseStartWaterG(schedule, 3)).toBe(380);
    expect(getPhaseStartWaterG(schedule, 4)).toBe(500);
  });

  it('falls back to the most recent earlier phase that has a target', () => {
    const sparse = buildPourSchedule(recipe({
      steps: [
        { atSec: 0, waterG: 60, note: 'Bloom' },
        { atSec: 30, note: 'Continue' },
        { atSec: 60, waterG: 200, note: 'Pour' }
      ],
      params: { targetTimeSec: 120 }
    }));
    expect(getPhaseStartWaterG(sparse, 0)).toBe(0);
    expect(getPhaseStartWaterG(sparse, 1)).toBe(60);
    expect(getPhaseStartWaterG(sparse, 2)).toBe(60);
  });

  it('returns 0 for out-of-range indices', () => {
    expect(getPhaseStartWaterG(schedule, -1)).toBe(0);
    expect(getPhaseStartWaterG(schedule, 999)).toBe(0);
  });
});

describe('getCurrentPhase', () => {
  const schedule = buildPourSchedule(recipe());

  it('returns the phase whose half-open range contains elapsedSec', () => {
    expect(getCurrentPhase(schedule, 0)?.index).toBe(0);
    expect(getCurrentPhase(schedule, 22)?.index).toBe(0);
    expect(getCurrentPhase(schedule, 44)?.index).toBe(0);
    expect(getCurrentPhase(schedule, 45)?.index).toBe(1);
    expect(getCurrentPhase(schedule, 104)?.index).toBe(1);
    expect(getCurrentPhase(schedule, 105)?.index).toBe(2);
    expect(getCurrentPhase(schedule, 219)?.index).toBe(3);
    expect(getCurrentPhase(schedule, 220)?.index).toBe(4);
  });

  it('returns null at or past totalSec', () => {
    expect(getCurrentPhase(schedule, 270)).toBeNull();
    expect(getCurrentPhase(schedule, 9999)).toBeNull();
  });

  it('returns null for negative or empty input', () => {
    expect(getCurrentPhase(schedule, -1)).toBeNull();
    expect(getCurrentPhase({ totalSec: 0, phases: [] }, 0)).toBeNull();
  });
});

describe('getExpectedWaterG', () => {
  const schedule = buildPourSchedule(recipe());

  it('linearly interpolates within the first phase from 0 to its target', () => {
    expect(getExpectedWaterG(schedule, 0)).toBe(0);
    expect(getExpectedWaterG(schedule, 22.5)).toBeCloseTo(40, 6);
    expect(getExpectedWaterG(schedule, 30)).toBeCloseTo((30 / 45) * 80, 6);
    expect(getExpectedWaterG(schedule, 44)).toBeCloseTo((44 / 45) * 80, 6);
  });

  it('starts later phases from the previous cumulative target', () => {
    expect(getExpectedWaterG(schedule, 45)).toBeCloseTo(80, 6);
    expect(getExpectedWaterG(schedule, 75)).toBeCloseTo(80 + 0.5 * (230 - 80), 6);
  });

  it('returns undefined past totalSec', () => {
    expect(getExpectedWaterG(schedule, 270)).toBeUndefined();
    expect(getExpectedWaterG(schedule, 9999)).toBeUndefined();
  });

  it('returns undefined when current phase has no targetWaterG', () => {
    const sparse = buildPourSchedule(recipe({
      steps: [
        { atSec: 0, waterG: 60, note: 'Bloom' },
        { atSec: 30, note: 'Continue' }
      ],
      params: { targetTimeSec: 60 }
    }));
    expect(getExpectedWaterG(sparse, 15)).toBeCloseTo(30, 6);
    expect(getExpectedWaterG(sparse, 45)).toBeUndefined();
  });
});

describe('getPhaseProgressRatio', () => {
  const schedule = buildPourSchedule(recipe());

  it('returns 0..1 within the current phase', () => {
    expect(getPhaseProgressRatio(schedule, 0)).toBeCloseTo(0, 6);
    expect(getPhaseProgressRatio(schedule, 22.5)).toBeCloseTo(0.5, 6);
    expect(getPhaseProgressRatio(schedule, 45)).toBeCloseTo(0, 6);
    expect(getPhaseProgressRatio(schedule, 75)).toBeCloseTo(0.5, 6);
  });

  it('returns 1 once the brew is finished', () => {
    expect(getPhaseProgressRatio(schedule, 270)).toBe(1);
    expect(getPhaseProgressRatio(schedule, 9999)).toBe(1);
  });

  it('returns 0 for negative input', () => {
    expect(getPhaseProgressRatio(schedule, -5)).toBe(0);
  });
});

describe('phaseRateGPerSec', () => {
  it('returns the explicit pour rate when provided', () => {
    const step: RecipeStep = { atSec: 0, endSec: 30, waterG: 60, pourRateGPerSec: 2.5, note: 'Bloom' };
    expect(phaseRateGPerSec(step, 0, 30)).toBe(2.5);
  });

  it('derives rate from cumulative water, atSec, and endSec when no explicit rate', () => {
    const step: RecipeStep = { atSec: 45, endSec: 75, waterG: 230, note: 'Pour' };
    expect(phaseRateGPerSec(step, 80, 75)).toBeCloseTo((230 - 80) / (75 - 45), 6);
  });

  it('returns undefined when endSec is missing', () => {
    expect(phaseRateGPerSec({ atSec: 45, waterG: 230, note: 'Pour' }, 80, 105)).toBeUndefined();
  });

  it('returns undefined when waterG is missing', () => {
    expect(phaseRateGPerSec({ atSec: 45, endSec: 75, note: 'Pour' }, 80, 75)).toBeUndefined();
  });

  it('returns undefined when target ≤ start (no positive water added)', () => {
    expect(
      phaseRateGPerSec({ atSec: 45, endSec: 75, waterG: 80, note: 'Pour' }, 80, 75)
    ).toBeUndefined();
  });

  it('returns undefined when span ≤ 0', () => {
    expect(
      phaseRateGPerSec({ atSec: 45, endSec: 45, waterG: 230, note: 'Bad' }, 80, 45)
    ).toBeUndefined();
  });
});

describe('buildBrewPhases', () => {
  it('produces the same shape as buildPourSchedule for legacy recipes (no endSec)', () => {
    const r = recipe();
    const phases = buildBrewPhases(r);
    expect(phases.map((p) => ({ kind: p.kind, startSec: p.startSec, endSec: p.endSec }))).toEqual([
      { kind: 'bloom', startSec: 0, endSec: 45 },
      { kind: 'pour', startSec: 45, endSec: 105 },
      { kind: 'pour', startSec: 105, endSec: 165 },
      { kind: 'pour', startSec: 165, endSec: 220 },
      { kind: 'pour', startSec: 220, endSec: 270 }
    ]);
    expect(phases[0].startWaterG).toBe(0);
    expect(phases[0].targetWaterG).toBe(80);
    expect(phases[1].startWaterG).toBe(80);
    expect(phases[1].targetWaterG).toBe(230);
    expect(phases.every((p) => p.pourRateGPerSec === undefined || typeof p.pourRateGPerSec === 'number')).toBe(true);
  });

  it('absorbs the rest into the preceding pour (no separate wait/drawdown phase)', () => {
    const phases = buildBrewPhases(recipe({
      steps: [
        { atSec: 0, endSec: 30, waterG: 60, note: 'Bloom' },
        { atSec: 60, endSec: 90, waterG: 200, note: 'Pour' }
      ],
      params: { targetTimeSec: 120 }
    }));
    expect(phases.map((p) => p.kind)).toEqual(['bloom', 'pour']);
    // Bloom pours until 0:30, then rests until the next pour starts at 1:00.
    expect(phases[0]).toMatchObject({ startSec: 0, pourEndSec: 30, endSec: 60, targetWaterG: 60 });
    // Final pour pours until 1:30, then its rest tail absorbs the drawdown to 2:00.
    expect(phases[1]).toMatchObject({ startSec: 60, pourEndSec: 90, endSec: 120, startWaterG: 60, targetWaterG: 200 });
  });

  it('preserves explicit pourRateGPerSec on the source step', () => {
    const phases = buildBrewPhases(recipe({
      steps: [
        { atSec: 0, endSec: 30, waterG: 60, pourRateGPerSec: 2, note: 'Bloom' }
      ],
      params: { targetTimeSec: 60 }
    }));
    expect(phases[0].pourRateGPerSec).toBe(2);
  });

  it('derives pourRateGPerSec when not explicit, given endSec + waterG', () => {
    const phases = buildBrewPhases(recipe({
      steps: [
        { atSec: 0, endSec: 30, waterG: 60, note: 'Bloom' },
        { atSec: 60, endSec: 90, waterG: 200, note: 'Pour' }
      ],
      params: { targetTimeSec: 120 }
    }));
    expect(phases[0].pourRateGPerSec).toBeCloseTo(60 / 30, 6);
    expect(phases[1].pourRateGPerSec).toBeCloseTo((200 - 60) / 30, 6);
  });

  it('does NOT inject wait/drawdown when no step has endSec (legacy recipes unchanged)', () => {
    const phases = buildBrewPhases(recipe({
      steps: [{ atSec: 0, waterG: 60, note: 'Bloom' }, { atSec: 60, waterG: 200, note: 'Pour' }],
      params: { targetTimeSec: 120 }
    }));
    expect(phases.map((p) => p.kind)).toEqual(['bloom', 'pour']);
    expect(phases.at(-1)?.endSec).toBe(120);
  });

  it('classifies the first phase as bloom and subsequent pours as pour', () => {
    const phases = buildBrewPhases(recipe());
    expect(phases[0].kind).toBe('bloom');
    expect(phases.slice(1).every((p) => p.kind === 'pour')).toBe(true);
  });

  it('carries the source step note onto pour-like phases', () => {
    const phases = buildBrewPhases(recipe());
    expect(phases.map((p) => p.note)).toEqual([
      'Bloom', 'First pour', 'Second pour', 'Third pour', 'Final pour'
    ]);
  });
});

describe('getCurrentBrewPhase', () => {
  const phases = buildBrewPhases(recipe({
    steps: [
      { atSec: 0, endSec: 30, waterG: 60, note: 'Bloom' },
      { atSec: 60, endSec: 90, waterG: 200, note: 'Pour' }
    ],
    params: { targetTimeSec: 120 }
  }));

  it('returns the phase whose half-open range contains elapsedSec', () => {
    expect(getCurrentBrewPhase(phases, 0)?.kind).toBe('bloom');
    expect(getCurrentBrewPhase(phases, 29)?.kind).toBe('bloom');
    // 0:30 is now the bloom block's rest tail, not a separate wait phase.
    expect(getCurrentBrewPhase(phases, 30)?.kind).toBe('bloom');
    expect(getCurrentBrewPhase(phases, 60)?.kind).toBe('pour');
    // 1:30 is the final pour's rest tail (formerly drawdown), still the pour block.
    expect(getCurrentBrewPhase(phases, 90)?.kind).toBe('pour');
  });

  it('returns null past the final endSec or for invalid input', () => {
    expect(getCurrentBrewPhase(phases, 120)).toBeNull();
    expect(getCurrentBrewPhase(phases, -1)).toBeNull();
    expect(getCurrentBrewPhase([], 0)).toBeNull();
  });
});

describe('getExpectedWaterGForPhase', () => {
  const phases = buildBrewPhases(recipe({
    steps: [
      { atSec: 0, endSec: 30, waterG: 60, note: 'Bloom' },
      { atSec: 60, endSec: 90, waterG: 200, note: 'Pour' }
    ],
    params: { targetTimeSec: 120 }
  }));

  it('interpolates within a pour phase', () => {
    expect(getExpectedWaterGForPhase(phases[0], 0)).toBeCloseTo(0, 6);
    expect(getExpectedWaterGForPhase(phases[0], 15)).toBeCloseTo(30, 6);
    expect(getExpectedWaterGForPhase(phases[0], 30)).toBeCloseTo(60, 6);
  });

  it('holds the target weight flat during the rest tail', () => {
    // Bloom block reaches 60g by 0:30, then rests until 1:00 — should stay 60.
    expect(getExpectedWaterGForPhase(phases[0], 45)).toBe(60);
    // Final pour reaches 200g by 1:30, holds through its drawdown tail.
    expect(getExpectedWaterGForPhase(phases[1], 100)).toBe(200);
  });

  it('returns undefined when targetWaterG is missing on a pour phase', () => {
    const sparse = buildBrewPhases(recipe({
      steps: [{ atSec: 0, note: 'Just a vibe' }],
      params: { targetTimeSec: 60 }
    }));
    expect(getExpectedWaterGForPhase(sparse[0], 30)).toBeUndefined();
  });
});

describe('isBrewPhaseResting', () => {
  const phases = buildBrewPhases(recipe({
    steps: [
      { atSec: 0, endSec: 30, waterG: 60, note: 'Bloom' },
      { atSec: 60, endSec: 90, waterG: 200, note: 'Pour' }
    ],
    params: { targetTimeSec: 120 }
  }));

  it('is false while still pouring, true once the pour window has passed', () => {
    expect(isBrewPhaseResting(phases[0], 15)).toBe(false);
    expect(isBrewPhaseResting(phases[0], 30)).toBe(true);
    expect(isBrewPhaseResting(phases[0], 45)).toBe(true);
  });

  it('is false for a pour with no rest tail (pourEndSec === endSec)', () => {
    const legacy = buildBrewPhases(recipe({
      steps: [{ atSec: 0, waterG: 60, note: 'Bloom' }, { atSec: 60, waterG: 200, note: 'Pour' }],
      params: { targetTimeSec: 120 }
    }));
    expect(isBrewPhaseResting(legacy[0], 59)).toBe(false);
  });
});

describe('getBrewPhaseProgressRatio', () => {
  it('returns clamped progress within [0, 1]', () => {
    const phase: BrewPhase = {
      index: 0, kind: 'pour', startSec: 30, pourEndSec: 30, endSec: 60,
      startLabel: '0:30', pourEndLabel: '0:30', endLabel: '1:00',
      startWaterG: 60, targetWaterG: undefined,
      pourRateGPerSec: undefined, note: undefined
    };
    expect(getBrewPhaseProgressRatio(phase, 30)).toBeCloseTo(0, 6);
    expect(getBrewPhaseProgressRatio(phase, 45)).toBeCloseTo(0.5, 6);
    expect(getBrewPhaseProgressRatio(phase, 60)).toBe(1);
    expect(getBrewPhaseProgressRatio(phase, 999)).toBe(1);
    expect(getBrewPhaseProgressRatio(phase, 0)).toBe(0);
  });
});
