import { describe, expect, it } from 'vitest';
import {
  feedbackValuesToInput,
  formDataToFeedbackValues,
  type FeedbackFormValues
} from './feedback-form';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe('formDataToFeedbackValues', () => {
  it('extracts and trims provided fields, omits blanks', () => {
    const values = formDataToFeedbackValues(
      fd({
        recipeCode: 'COF-0001',
        overall: '4',
        sweetness: '3',
        burnt: '1',
        bitter: '',
        comment: '  tasted balanced  ',
        desiredDirectionText: 'sweeter\nless burnt\n',
        tempC: '92',
        grind: 'medium-fine',
        timeSec: '180'
      })
    );
    expect(values).toEqual({
      recipeCode: 'COF-0001',
      overall: '4',
      sweetness: '3',
      burnt: '1',
      comment: 'tasted balanced',
      desiredDirectionText: 'sweeter\nless burnt\n',
      tempC: '92',
      grind: 'medium-fine',
      timeSec: '180'
    });
  });
});

describe('feedbackValuesToInput', () => {
  it('builds ratings only from provided rating fields', () => {
    const values: FeedbackFormValues = {
      recipeCode: 'COF-0001',
      overall: '4',
      sweetness: '3',
      burnt: '1'
    };
    const input = feedbackValuesToInput(values);
    expect(input).toEqual({
      recipeCode: 'COF-0001',
      ratings: { overall: 4, sweetness: 3, burnt: 1 }
    });
  });

  it('omits ratings keys that are blank or non-numeric', () => {
    const values: FeedbackFormValues = {
      recipeCode: 'COF-0001',
      overall: '',
      sweetness: '3',
      bitter: 'x'
    };
    const input = feedbackValuesToInput(values);
    expect(input.ratings).toEqual({ sweetness: 3 });
    expect('overall' in input.ratings).toBe(false);
    expect('bitter' in input.ratings).toBe(false);
  });

  it('converts desiredDirectionText into a string array of non-empty trimmed lines', () => {
    const input = feedbackValuesToInput({
      recipeCode: 'COF-0001',
      overall: '4',
      desiredDirectionText: 'sweeter\n\n  less burnt  \n'
    });
    expect(input.desiredDirection).toEqual(['sweeter', 'less burnt']);
  });

  it('builds actual only when at least one actual field is present', () => {
    const a = feedbackValuesToInput({ recipeCode: 'COF-0001', overall: '4' });
    expect(a.actual).toBeUndefined();

    const b = feedbackValuesToInput({
      recipeCode: 'COF-0001',
      overall: '4',
      tempC: '92',
      grind: 'medium-fine',
      timeSec: '180'
    });
    expect(b.actual).toEqual({ tempC: 92, grind: 'medium-fine', timeSec: 180 });
  });

  it('omits source so the repository default applies', () => {
    const input = feedbackValuesToInput({ recipeCode: 'COF-0001', overall: '4' });
    expect('source' in input).toBe(false);
  });

  it('passes through comment when present', () => {
    const input = feedbackValuesToInput({
      recipeCode: 'COF-0001',
      overall: '4',
      comment: 'tasted balanced'
    });
    expect(input.comment).toBe('tasted balanced');
  });
});
