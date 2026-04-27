import { describe, expect, it } from 'vitest';
import {
  formDataToRecipeValues,
  recipeValuesToInput,
  type RecipeFormValues
} from './recipe-form';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe('formDataToRecipeValues', () => {
  it('extracts and trims provided fields, omits blanks', () => {
    const values = formDataToRecipeValues(
      fd({
        title: '  Test V60  ',
        method: 'v60',
        beanName: 'Yirgacheffe ',
        roaster: '',
        roastDate: '2026-04-01',
        roastLevel: 'light',
        origin: 'Ethiopia',
        process: 'washed',
        beanNotes: 'Floral notes',
        doseG: ' 15 ',
        waterG: '240',
        tempC: '',
        grind: 'medium-fine',
        grinder: 'KINGrinder K6',
        brewer: 'Hario V60',
        targetTimeSec: '180',
        notes: 'First attempt',
        intentText: 'sweeter\nless burnt\n',
        stepsText: 'Bloom 40g for 35s\nPour to 160g\n'
      })
    );
    expect(values).toEqual({
      title: 'Test V60',
      method: 'v60',
      beanName: 'Yirgacheffe',
      roastDate: '2026-04-01',
      roastLevel: 'light',
      origin: 'Ethiopia',
      process: 'washed',
      beanNotes: 'Floral notes',
      doseG: '15',
      waterG: '240',
      grind: 'medium-fine',
      grinder: 'KINGrinder K6',
      brewer: 'Hario V60',
      targetTimeSec: '180',
      notes: 'First attempt',
      intentText: 'sweeter\nless burnt\n',
      stepsText: 'Bloom 40g for 35s\nPour to 160g\n'
    });
  });
});

describe('recipeValuesToInput', () => {
  it('converts required fields and omits empty optionals', () => {
    const values: RecipeFormValues = { title: 'Test V60', method: 'v60' };
    const input = recipeValuesToInput(values);
    expect(input).toEqual({ method: 'v60', title: 'Test V60' });
  });

  it('parses numeric params and includes them when provided', () => {
    const values: RecipeFormValues = {
      title: 'Test V60',
      method: 'v60',
      doseG: '15',
      waterG: '240',
      tempC: '92',
      grind: 'medium-fine',
      grinder: 'KINGrinder K6',
      brewer: 'Hario V60',
      targetTimeSec: '180'
    };
    const input = recipeValuesToInput(values);
    expect(input).toEqual({
      method: 'v60',
      title: 'Test V60',
      params: { doseG: 15, waterG: 240, tempC: 92, grind: 'medium-fine', grinder: 'KINGrinder K6', brewer: 'Hario V60', targetTimeSec: 180 }
    });
  });

  it('builds beanSnapshot only when at least one bean field is present', () => {
    const a = recipeValuesToInput({ title: 'a', method: 'v60' });
    expect(a.beanSnapshot).toBeUndefined();

    const b = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      beanName: 'Yirg',
      roastDate: '2026-04-01'
    });
    expect(b.beanSnapshot).toEqual({ name: 'Yirg', roastDate: '2026-04-01' });

    const c = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      beanName: 'Starbucks Blonde',
      roaster: 'Starbucks',
      roastLevel: 'blonde',
      origin: 'Latin America',
      process: 'washed',
      beanNotes: 'Smooth and sweet'
    });
    expect(c.beanSnapshot).toEqual({
      name: 'Starbucks Blonde',
      roaster: 'Starbucks',
      roastLevel: 'blonde',
      origin: 'Latin America',
      process: 'washed',
      notes: 'Smooth and sweet'
    });
  });

  it('includes recipe notes when provided', () => {
    const input = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      notes: 'Used 90 clicks on KINGrinder K6'
    });
    expect(input.notes).toBe('Used 90 clicks on KINGrinder K6');
  });

  it('converts intentText into a string array of non-empty trimmed lines', () => {
    const input = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      intentText: 'sweeter\n\n  less burnt  \n'
    });
    expect(input.intent).toEqual(['sweeter', 'less burnt']);
  });

  it('converts stepsText into note-only steps from non-empty trimmed lines', () => {
    const input = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      stepsText: 'Bloom 40g for 35s\n\n  Pour to 160g \n'
    });
    expect(input.steps).toEqual([{ note: 'Bloom 40g for 35s' }, { note: 'Pour to 160g' }]);
  });

  it('skips numeric params that are not finite numbers', () => {
    const input = recipeValuesToInput({
      title: 'a',
      method: 'v60',
      doseG: 'not-a-number',
      waterG: '   '
    });
    expect(input.params).toBeUndefined();
  });
});
