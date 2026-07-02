import { describe, it, expect } from 'vitest';
import { scaleRecipe, round1 } from './recipe-scale';
import type { RecipeDoc } from './domain';

function fixture(overrides: Partial<RecipeDoc> = {}): RecipeDoc {
  return {
    _id: 'recipe:COF-TEST',
    type: 'recipe',
    code: 'COF-TEST',
    method: 'v60',
    version: 1,
    title: '예가체프 베이스',
    params: { doseG: 20, waterG: 320, ratio: '1:16', tempC: 92 },
    steps: [
      { atSec: 0, endSec: 35, waterG: 40, note: '블루밍' },
      { atSec: 35, endSec: 70, waterG: 160, note: '1차 푸어' },
      { atSec: 70, endSec: 105, waterG: 320, note: '2차 푸어' },
    ],
    createdBy: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('round1', () => {
  it('rounds to one decimal place (half-up)', () => {
    expect(round1(47.04)).toBe(47);
    expect(round1(47.55)).toBe(47.6);
    expect(round1(376)).toBe(376);
    expect(round1(0)).toBe(0);
    expect(round1(47.46)).toBe(47.5);
  });
});

describe('scaleRecipe', () => {
  it('scales doseG, params.waterG, and every step.waterG by k', () => {
    const out = scaleRecipe(fixture(), 23.5);
    expect(out.params!.doseG).toBe(23.5);
    expect(out.params!.waterG).toBe(376); // 320 * 1.175 = 376
    expect(out.steps![0].waterG).toBe(47); // 40 * 1.175 = 47
    expect(out.steps![1].waterG).toBe(188); // 160 * 1.175 = 188
    expect(out.steps![2].waterG).toBe(376); // 320 * 1.175 = 376
  });

  it('preserves ratio, tempC, grind verbatim (unchanged)', () => {
    const out = scaleRecipe(fixture(), 30);
    expect(out.params!.ratio).toBe('1:16');
    expect(out.params!.tempC).toBe(92);
  });

  it('preserves step atSec/endSec/pourRateGPerSec/note verbatim', () => {
    const out = scaleRecipe(fixture(), 25);
    expect(out.steps![0].atSec).toBe(0);
    expect(out.steps![0].endSec).toBe(35);
    expect(out.steps![0].note).toBe('블루밍');
    expect(out.steps![2].atSec).toBe(70);
    expect(out.steps![2].endSec).toBe(105);
    expect(out.steps![2].note).toBe('2차 푸어');
  });

  it('omits waterG when the source had none', () => {
    const noWater = fixture({
      params: { doseG: 20, ratio: '1:16', tempC: 92 },
      steps: [{ atSec: 0, endSec: 30, note: '블루밍' }],
    });
    const out = scaleRecipe(noWater, 24);
    expect(out.params!.waterG).toBeUndefined();
    expect(out.steps![0].waterG).toBeUndefined();
  });

  it('preserves optional grinder/brewer/targetTimeSec when present', () => {
    const withExtras = fixture({
      params: { doseG: 20, waterG: 320, grinder: 'Comandante C40', brewer: 'v60', targetTimeSec: 180 },
    });
    const out = scaleRecipe(withExtras, 22);
    expect(out.params!.grinder).toBe('Comandante C40');
    expect(out.params!.brewer).toBe('v60');
    expect(out.params!.targetTimeSec).toBe(180);
  });

  it('carries method, beanId, beanSnapshot, intent, dripperPortability through', () => {
    const rich = fixture({
      beanId: 'bean-1',
      beanSnapshot: { name: '예가체프', roaster: '로스터A' },
      intent: ['fruit-forward'],
      dripperPortability: {
        origin: { dripper: 'V60' },
        anchors: { ratio: '1:16' },
      },
    });
    const out = scaleRecipe(rich, 21);
    expect(out.method).toBe('v60');
    expect(out.beanId).toBe('bean-1');
    expect(out.beanSnapshot).toEqual({ name: '예가체프', roaster: '로스터A' });
    expect(out.intent).toEqual(['fruit-forward']);
    expect(out.dripperPortability).toEqual({ origin: { dripper: 'V60' }, anchors: { ratio: '1:16' } });
  });

  it('builds a title with the new dose and an adjustment note with both doses', () => {
    const out = scaleRecipe(fixture(), 23.5);
    expect(out.title).toBe('예가체프 베이스 · 23.5g');
    expect(out.adjustmentFromPrevious).toBe('20g → 23.5g 용량 스케일');
    expect(out.adjustmentFromPrevious).toContain('20g');
    expect(out.adjustmentFromPrevious).toContain('23.5g');
  });

  it('does not set null on omitted optionals (undefined only)', () => {
    const out = scaleRecipe(fixture(), 22);
    expect(out.notes).toBeUndefined();
    expect(out.createdBy).toBeUndefined();
  });

  it('throws on missing or non-positive oldDose (button is disabled, but guard anyway)', () => {
    const noDose = fixture({ params: { waterG: 320, ratio: '1:16' } });
    expect(() => scaleRecipe(noDose, 22)).toThrow(/doseG/);
    const zeroDose = fixture({ params: { doseG: 0, waterG: 320 } });
    expect(() => scaleRecipe(zeroDose, 22)).toThrow(/doseG/);
  });

  it('throws on invalid newDose', () => {
    expect(() => scaleRecipe(fixture(), 0)).toThrow(/newDose/);
    expect(() => scaleRecipe(fixture(), -5)).toThrow(/newDose/);
    expect(() => scaleRecipe(fixture(), Number.NaN)).toThrow(/newDose/);
  });

  it('preserves a structured GrindSpec verbatim (not recomputed)', () => {
    const grindSpec = {
      target: { brewMethodPosition: 'v60 medium-fine', targetDrawdownSec: 150 },
      perGrinder: [{ grinder: 'C40', clicks: 28, source: 'measured' as const }],
    };
    const withGrind = fixture({ params: { doseG: 20, waterG: 320, grind: grindSpec } });
    const out = scaleRecipe(withGrind, 22);
    expect(out.params!.grind).toEqual(grindSpec);
  });
});
