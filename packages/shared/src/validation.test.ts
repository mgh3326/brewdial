import { describe, expect, it } from 'vitest';
import {
  validateCreateFeedbackInput,
  validateCreateRecipeInput
} from './validation';

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
      params: { doseG: 18, waterG: 36, tempC: 93 },
      steps: [{ atSec: 0, waterG: 0, note: 'Pre-infuse' }],
      intent: ['sweeter'],
      adjustmentFromPrevious: 'finer grind',
      createdBy: 'agent',
      beanId: 'bean:abc',
      beanSnapshot: { name: 'Geisha', roaster: 'Tim', roastDate: '2026-04-01' }
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

  it('rejects when ratings has no fields', () => {
    const result = validateCreateFeedbackInput({
      recipeCode: 'COF-0001',
      ratings: {}
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/ratings/);
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
