import { describe, expect, it } from 'vitest';
import { buildPourSchedule, formatSeconds } from './pour-schedule';
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
