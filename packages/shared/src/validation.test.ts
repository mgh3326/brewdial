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
