import { describe, expect, it } from 'vitest';
import {
  validateCreateFeedbackInput,
  validateCreateRecipeInput
} from './validation.js';

describe('validateCreateRecipeInput', () => {
  it('accepts a minimal valid input and strips unknown fields', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'Test V60',
      bogus: 'should be dropped'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.method).toBe('v60');
      expect(result.value.title).toBe('Test V60');
      expect((result.value as unknown as Record<string, unknown>).bogus).toBeUndefined();
    }
  });

  it('accepts a full valid input including params, steps, and beanSnapshot', () => {
    const result = validateCreateRecipeInput({
      method: 'espresso',
      title: 'Morning shot',
      params: { doseG: 18, waterG: 36, tempC: 93, grinder: 'KINGrinder K6', brewer: 'Gaggia Classic' },
      steps: [{ atSec: 0, waterG: 0, note: 'Pre-infuse' }],
      intent: ['sweeter'],
      notes: 'First attempt with new grinder',
      adjustmentFromPrevious: 'finer grind',
      createdBy: 'agent',
      beanId: 'bean:abc',
      beanSnapshot: { name: 'Geisha', roaster: 'Tim', roastDate: '2026-04-01', roastLevel: 'light', origin: 'Ethiopia', process: 'washed', notes: 'Floral, citrus' }
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when input is not an object', () => {
    const result = validateCreateRecipeInput('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects missing title', () => {
    const result = validateCreateRecipeInput({ method: 'v60' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/title/);
  });

  it('rejects empty title', () => {
    const result = validateCreateRecipeInput({ method: 'v60', title: '   ' });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid method', () => {
    const result = validateCreateRecipeInput({ method: 'french-press', title: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/method/);
  });

  it('rejects a step missing note', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'X',
      steps: [{ atSec: 0, waterG: 40 }]
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a step with endSec and pourRateGPerSec', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'Structured',
      steps: [{ atSec: 0, endSec: 35, waterG: 60, pourRateGPerSec: 1.7, note: 'Bloom' }]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.steps).toEqual([
        { atSec: 0, endSec: 35, waterG: 60, pourRateGPerSec: 1.7, note: 'Bloom' }
      ]);
    }
  });

  it('rejects negative endSec', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'X',
      steps: [{ atSec: 0, endSec: -1, note: 'Bloom' }]
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/endSec/);
  });

  it('rejects endSec that is not greater than atSec', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'X',
      steps: [{ atSec: 30, endSec: 30, note: 'Bloom' }]
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/greater than atSec/);
  });

  it('rejects non-numeric pourRateGPerSec', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'X',
      steps: [{ atSec: 0, pourRateGPerSec: 'fast', note: 'Bloom' }]
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/pourRateGPerSec/);
  });

  it('rejects non-positive pourRateGPerSec', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'X',
      steps: [{ atSec: 0, pourRateGPerSec: 0, note: 'Bloom' }]
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/positive/);
  });

  it('still accepts legacy {atSec, waterG, note} steps unchanged', () => {
    const result = validateCreateRecipeInput({
      method: 'v60',
      title: 'Legacy',
      steps: [{ atSec: 0, waterG: 40, note: 'Bloom' }]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.steps).toEqual([{ atSec: 0, waterG: 40, note: 'Bloom' }]);
    }
  });
});

describe('validateCreateFeedbackInput', () => {
  it('accepts a minimal valid feedback', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      ratings: { overall: 4 }
    });
    expect(result.ok).toBe(true);
  });

  it('accepts feedback with sensory ratings, actual, and arrays', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0042',
      ratings: { overall: 5, sweetness: 3, burnt: 1 },
      actual: { tempC: 92, grind: 'medium', timeSec: 180 },
      comment: 'Solid',
      desiredDirection: ['sweeter'],
      nextHint: ['try +2C'],
      source: 'agent'
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when input is not an object', () => {
    expect(validateCreateFeedbackInput(null).ok).toBe(false);
  });

  it('rejects an invalid recipeCode shape', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'XYZ-1',
      ratings: { overall: 4 }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/recipeCode/);
  });

  it('rejects when ratings has no fields and no other content', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      ratings: {}
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/at least one/);
  });

  it('rejects when overall is out of range', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      ratings: { overall: 6 }
    });
    expect(result.ok).toBe(false);
  });

  it('rejects when a sensory rating is out of range', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      ratings: { sweetness: 5 }
    });
    expect(result.ok).toBe(false);
  });
});

describe('validateCreateFeedbackInput (ROB-33)', () => {
  it('accepts rawComment-only feedback without ratings', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      rawComment: '오늘은 산미가 너무 강했음'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rawComment).toBe('오늘은 산미가 너무 강했음');
      expect(result.value.ratings).toBeUndefined();
    }
  });

  it('accepts quickTags-only feedback', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      quickTags: ['고소함', '좋았음']
    });
    expect(result.ok).toBe(true);
  });

  it('rejects whitespace-only rawComment without any other content', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      rawComment: '   '
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/at least one/);
    }
  });

  it('rejects empty feedback (no rawComment, ratings, or quickTags)', () => {
    const result = validateCreateFeedbackInput({ recipeCode: 'COF-0001' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/at least one/);
    }
  });

  it('rejects unknown quickTags', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      quickTags: ['고소함', '말도안되는태그']
    });
    expect(result.ok).toBe(false);
  });

  it('accepts new source values coffee_profile and api', () => {
    for (const source of ['coffee_profile', 'api', 'web', 'agent', 'mcp']) {
      const r = validateCreateFeedbackInput({
        recipeCode: 'COF-0001',
        rawComment: 'x',
        source
      });
      expect(r.ok).toBe(true);
    }
  });
});

describe('validateCreateRecipeInput cross-field/range (ROB-608)', () => {
  const pourOver = (overrides: Record<string, unknown> = {}) => ({
    method: 'v60',
    title: 'V60',
    params: { doseG: 15, waterG: 240, tempC: 92, targetTimeSec: 150 },
    steps: [
      { atSec: 0, endSec: 35, waterG: 40, note: 'Bloom' },
      { atSec: 45, endSec: 75, waterG: 140, note: 'Pour 1' },
      { atSec: 85, endSec: 110, waterG: 240, note: 'Pour 2' }
    ],
    ...overrides
  });

  it('accepts a consistent pour-over recipe with no warnings', () => {
    const r = validateCreateRecipeInput(pourOver());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it('rejects a step waterG exceeding params.waterG', () => {
    const r = validateCreateRecipeInput(
      pourOver({ steps: [{ atSec: 0, endSec: 35, waterG: 300, note: 'Bloom' }] })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/exceeds total/);
  });

  it('rejects decreasing cumulative step waterG', () => {
    const r = validateCreateRecipeInput(
      pourOver({
        steps: [
          { atSec: 0, endSec: 35, waterG: 140, note: 'Bloom' },
          { atSec: 45, endSec: 75, waterG: 100, note: 'Pour 1' },
          { atSec: 85, endSec: 110, waterG: 240, note: 'Pour 2' }
        ]
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/decreases/);
  });

  it('rejects overlapping step times', () => {
    const r = validateCreateRecipeInput(
      pourOver({
        steps: [
          { atSec: 0, endSec: 50, waterG: 40, note: 'Bloom' },
          { atSec: 45, endSec: 75, waterG: 240, note: 'Pour 1' }
        ]
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/overlap/);
  });

  it('rejects targetTimeSec before the last pour ends', () => {
    const r = validateCreateRecipeInput(
      pourOver({ params: { doseG: 15, waterG: 240, tempC: 92, targetTimeSec: 90 } })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/before the last pour/);
  });

  it('rejects impossible ranges (doseG <= 0, tempC > 100)', () => {
    expect(validateCreateRecipeInput(pourOver({ params: { doseG: 0, waterG: 240 } })).ok).toBe(false);
    expect(
      validateCreateRecipeInput(pourOver({ params: { doseG: 15, waterG: 240, tempC: 130 } })).ok
    ).toBe(false);
  });

  it('warns (not rejects) when the final step does not reach params.waterG (COF-0001-like)', () => {
    const r = validateCreateRecipeInput(
      pourOver({
        params: { doseG: 15, waterG: 240, tempC: 92, targetTimeSec: 150 },
        steps: [
          { atSec: 0, endSec: 35, waterG: 40, note: 'Bloom' },
          { atSec: 45, endSec: 110, waterG: 200, note: 'Pour 1' }
        ]
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/does not reach/);
  });

  it('warns on an unrealistic drawdown gap (COF-0023/0040-like)', () => {
    const r = validateCreateRecipeInput(
      pourOver({ params: { doseG: 15, waterG: 240, tempC: 92, targetTimeSec: 200 } })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/drawdown/);
  });

  it('warns on a ratio that disagrees with waterG/doseG', () => {
    const r = validateCreateRecipeInput(
      pourOver({ params: { doseG: 15, waterG: 240, ratio: '1:18', tempC: 92, targetTimeSec: 150 } })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/ratio/);
  });

  it('warns when a timed step is missing endSec (COF-0005/0031/0032-like)', () => {
    const r = validateCreateRecipeInput(
      pourOver({
        params: { doseG: 15, waterG: 240, tempC: 92 },
        steps: [
          { atSec: 0, waterG: 40, note: 'Bloom' },
          { atSec: 45, waterG: 240, note: 'Pour 1' }
        ]
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/endSec/);
  });

  it('exempts method=other (instant) from cross-field checks (COF-0018-like)', () => {
    const r = validateCreateRecipeInput({
      method: 'other',
      title: '인스턴트 스틱',
      params: { waterG: 200 },
      steps: [{ atSec: 0, waterG: 999, note: 'Stir' }]
    });
    expect(r.ok).toBe(true);
  });

  it('does not apply the pour-over water schedule to espresso', () => {
    const r = validateCreateRecipeInput({
      method: 'espresso',
      title: 'Shot',
      params: { doseG: 18, waterG: 36, tempC: 93 },
      steps: [{ atSec: 0, waterG: 0, note: 'Pre-infuse' }]
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).not.toMatch(/does not reach/);
  });
});
