import { describe, expect, it } from 'vitest';
import {
  buildPourSchedule,
  formatSeconds,
  getCurrentPhase,
  getExpectedWaterG,
  getPhaseProgressRatio,
  getPhaseStartWaterG,
  roundToStep
} from './pour-schedule';
import type { RecipeDoc } from '@brewdial/shared';

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
