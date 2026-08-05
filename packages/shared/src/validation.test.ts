import { describe, expect, it } from 'vitest';
import {
  validateCreateBeanPurchaseLinkInput,
  validateCreateFeedbackInput,
  validateCreateRecipeInput,
  validateUpdateBeanAttributesInput,
  validateUpdatePreferencesInput,
  validateUpdateRecipeInput
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

describe('validateCreateRecipeInput — ROB-611 grind portability', () => {
  it('accepts legacy string grind (backward compatible)', () => {
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Legacy',
      params: { grind: 'KINGrinder K6 102클릭으로 시작' }
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.params?.grind).toBe('KINGrinder K6 102클릭으로 시작');
  });

  it('accepts a structured GrindSpec and mirrors targetDrawdownSec into targetTimeSec', () => {
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Structured',
      params: {
        grind: {
          target: { brewMethodPosition: 'v60 medium-fine', targetDrawdownSec: 265, microns: 700 },
          perGrinder: [
            { grinder: 'KINGrinder K6', clicks: 102, source: 'measured' },
            { grinder: 'Comandante C40', clicks: '25-28', source: 'dial-in-start' }
          ]
        }
      }
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const grind = r.value.params?.grind;
      expect(typeof grind).toBe('object');
      if (grind && typeof grind === 'object') {
        expect(grind.target.targetDrawdownSec).toBe(265);
        expect(grind.perGrinder?.length).toBe(2);
      }
      expect(r.value.params?.targetTimeSec).toBe(265); // mirrored for dedup correctness
    }
  });

  it('rejects a GrindSpec target with neither brewMethodPosition nor targetDrawdownSec (microns-only)', () => {
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Microns only',
      params: { grind: { target: { microns: 700 } } }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/brewMethodPosition or targetDrawdownSec/);
  });

  it('rejects a stepless grinder with numeric clicks', () => {
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Stepless',
      params: {
        grind: {
          target: { brewMethodPosition: 'v60 medium' },
          perGrinder: [{ grinder: '1Zpresso', clicks: 12, stepless: true, source: 'measured' }]
        }
      }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/stepless/);
  });

  it('does not overwrite an explicit targetTimeSec with the grind mirror', () => {
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Explicit time',
      params: {
        targetTimeSec: 200,
        grind: { target: { brewMethodPosition: 'v60', targetDrawdownSec: 265 } }
      }
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.params?.targetTimeSec).toBe(200);
  });
});

describe('validateCreateRecipeInput — ROB-612 dripper portability', () => {
  it('accepts a valid dripperPortability layer', () => {
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Dripper-portable',
      dripperPortability: {
        origin: { dripper: 'Hario V60', sizeModel: '02' },
        anchors: { ratio: '1:16', tempC: 92, targetDrawdownSec: 165 },
        classNote: 'bed-restricted / cone',
        targets: [
          {
            dripper: 'Kalita Wave 185',
            class: 'dripper_restricted',
            sizeMatch: 'ok',
            grindShift: 'coarser',
            pourShift: 'fewer_pours',
            confidence: 'medium',
            warn: 'large dose: keep bed depth similar'
          }
        ]
      }
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.dripperPortability?.origin.dripper).toBe('Hario V60');
      expect(r.value.dripperPortability?.targets?.length).toBe(1);
    }
  });

  it('rejects dripperPortability without origin.dripper', () => {
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'No origin',
      dripperPortability: { anchors: { ratio: '1:16' } }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/origin\.dripper/);
  });

  it('rejects an invalid target class', () => {
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Bad class',
      dripperPortability: {
        origin: { dripper: 'Hario V60' },
        targets: [
          {
            dripper: 'Kalita',
            class: 'weird',
            sizeMatch: 'ok',
            grindShift: 'coarser',
            pourShift: 'none',
            confidence: 'low'
          }
        ]
      }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/class must be one of/);
  });
});

describe('validator defensive branches (ROB-611/612 caps + enums)', () => {
  it('rejects a grind perGrinder array over the 10-entry cap', () => {
    const perGrinder = Array.from({ length: 11 }, (_, i) => ({
      grinder: `G${i}`,
      clicks: 100,
      source: 'measured' as const
    }));
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Too many grinders',
      params: { grind: { target: { brewMethodPosition: 'v60' }, perGrinder } }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/at most 10/);
  });

  it('rejects a dripperPortability targets array over the 30-entry cap', () => {
    const targets = Array.from({ length: 31 }, () => ({
      dripper: 'Kalita',
      class: 'dripper_restricted',
      sizeMatch: 'ok',
      grindShift: 'coarser',
      pourShift: 'none',
      confidence: 'low'
    }));
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Too many targets',
      dripperPortability: { origin: { dripper: 'Hario V60' }, targets }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/at most 30/);
  });

  it('rejects a dripper target warn over 280 chars', () => {
    const r = validateCreateRecipeInput({
      method: 'v60',
      title: 'Long warn',
      dripperPortability: {
        origin: { dripper: 'Hario V60' },
        targets: [
          {
            dripper: 'Kalita',
            class: 'dripper_restricted',
            sizeMatch: 'ok',
            grindShift: 'none',
            pourShift: 'none',
            confidence: 'low',
            warn: 'x'.repeat(281)
          }
        ]
      }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/at most 280/);
  });

  it('rejects each invalid dripper target enum (sizeMatch/grindShift/pourShift/confidence)', () => {
    for (const bad of [
      { sizeMatch: 'huge' },
      { grindShift: 'chunky' },
      { pourShift: 'splash' },
      { confidence: 'maybe' }
    ]) {
      const r = validateCreateRecipeInput({
        method: 'v60',
        title: 'Bad enum',
        dripperPortability: {
          origin: { dripper: 'Hario V60' },
          targets: [
            {
              dripper: 'Kalita',
              class: 'dripper_restricted',
              sizeMatch: 'ok',
              grindShift: 'none',
              pourShift: 'none',
              confidence: 'low',
              ...bad
            }
          ]
        }
      });
      expect(r.ok).toBe(false);
    }
  });
});

describe('validateUpdateRecipeInput (partial-patch trust boundary)', () => {
  it('accepts a valid partial patch (notes + dripperPortability)', () => {
    const r = validateUpdateRecipeInput({
      notes: 'tweaked',
      dripperPortability: { origin: { dripper: 'Hario V60' } }
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.notes).toBe('tweaked');
      expect(r.value.dripperPortability?.origin.dripper).toBe('Hario V60');
    }
  });

  it('rejects a malformed grind (microns-only) on update — no DB bypass', () => {
    const r = validateUpdateRecipeInput({ params: { grind: { target: { microns: 700 } } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/brewMethodPosition or targetDrawdownSec/);
  });

  it('rejects a non-object input', () => {
    const r = validateUpdateRecipeInput('nope');
    expect(r.ok).toBe(false);
  });
});

describe('validateUpdateBeanAttributesInput', () => {
  it('accepts a full valid attribute set', () => {
    const r = validateUpdateBeanAttributesInput({
      roastLevelOrd: 4,
      agtronMin: 57,
      agtronMax: 59,
      acidity: 1,
      body: 5,
      decaf: false,
      flavorCategories: ['nutty_cocoa', 'sweet'],
      attrsSource: 'roaster_page',
      sourceUrl: 'https://example.com/x',
      attrsNotes: '산미1/무게감4.5',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.acidity).toBe(1);
      expect(r.value.flavorCategories).toEqual(['nutty_cocoa', 'sweet']);
      expect(r.value.attrsSource).toBe('roaster_page');
    }
  });

  it('rejects out-of-range 1..5 axes', () => {
    for (const bad of [{ acidity: 0 }, { acidity: 6 }, { body: 9 }, { roastLevelOrd: 0 }]) {
      expect(validateUpdateBeanAttributesInput(bad).ok).toBe(false);
    }
  });

  it('rejects agtronMax < agtronMin', () => {
    const r = validateUpdateBeanAttributesInput({ agtronMin: 90, agtronMax: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/agtronMax must be >= agtronMin/);
  });

  it('rejects an unknown flavor category', () => {
    const r = validateUpdateBeanAttributesInput({ flavorCategories: ['chocolate'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/flavorCategories contains unknown/);
  });

  it('rejects an unknown attrsSource', () => {
    expect(validateUpdateBeanAttributesInput({ attrsSource: 'blog' }).ok).toBe(false);
  });

  it('requires at least one attribute (empty object)', () => {
    const r = validateUpdateBeanAttributesInput({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/at least one bean attribute/);
  });

  it('rejects a non-object input', () => {
    expect(validateUpdateBeanAttributesInput('nope').ok).toBe(false);
  });
});

describe('validateCreateBeanPurchaseLinkInput', () => {
  const VALID = { vendor: 'Kurly', url: 'https://www.kurlyglobal.com/products/m00000176042' };

  it('accepts a minimal vendor + https url', () => {
    const r = validateCreateBeanPurchaseLinkInput(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.vendor).toBe('Kurly');
      // Optional fields stay absent so the DB defaults apply.
      expect(r.value.linkCategory).toBeUndefined();
      expect(r.value.priceKrw).toBeUndefined();
    }
  });

  it('accepts the full optional set', () => {
    const r = validateCreateBeanPurchaseLinkInput({
      ...VALID,
      linkCategory: 'product',
      priceKrw: 31000,
      isAffiliate: false,
      sortOrder: 1
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.priceKrw).toBe(31000);
  });

  it('requires vendor and url', () => {
    const r = validateCreateBeanPurchaseLinkInput({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(' ')).toMatch(/vendor is required/);
      expect(r.errors.join(' ')).toMatch(/url is required/);
    }
  });

  // bean_purchase_links_url_https — reject before the DB CHECK does.
  it('rejects a non-https url', () => {
    const r = validateCreateBeanPurchaseLinkInput({ ...VALID, url: 'http://example.com/x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/must start with https/);
  });

  // bean_purchase_links_vendor_len
  it('rejects a vendor over 60 chars', () => {
    const r = validateCreateBeanPurchaseLinkInput({ ...VALID, vendor: 'x'.repeat(61) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/60 characters/);
  });

  it('rejects an unknown linkCategory', () => {
    const r = validateCreateBeanPurchaseLinkInput({ ...VALID, linkCategory: 'affiliate' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/linkCategory must be one of/);
  });

  it('rejects a negative or non-integer priceKrw', () => {
    expect(validateCreateBeanPurchaseLinkInput({ ...VALID, priceKrw: -1 }).ok).toBe(false);
    expect(validateCreateBeanPurchaseLinkInput({ ...VALID, priceKrw: 1.5 }).ok).toBe(false);
  });

  it('rejects a non-object input', () => {
    expect(validateCreateBeanPurchaseLinkInput('nope').ok).toBe(false);
  });
});

describe('validateUpdatePreferencesInput', () => {
  it('accepts whitelisted like/dislike tags', () => {
    const r = validateUpdatePreferencesInput({ likes: ['저산미', '다크 로스팅'], dislikes: ['고산미'] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.likes).toEqual(['저산미', '다크 로스팅']); expect(r.value.dislikes).toEqual(['고산미']); }
  });
  it('rejects an unknown tag', () => {
    const r = validateUpdatePreferencesInput({ likes: ['초코비'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/unknown taste tag/);
  });
  it('defaults missing arrays to empty and dedupes', () => {
    const r = validateUpdatePreferencesInput({ likes: ['저산미', '저산미'] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.likes).toEqual(['저산미']); expect(r.value.dislikes).toEqual([]); }
  });
  it('rejects a non-object', () => { expect(validateUpdatePreferencesInput('x').ok).toBe(false); });
});
