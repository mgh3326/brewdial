import { describe, expect, it } from 'vitest';
import { deriveTasteTarget, scoreBean, type TasteSignals } from './recommend.js';
import type { BeanAttributes } from './types.js';

const brily: BeanAttributes = { roastLevelOrd: 5, acidity: 1, body: 4, flavorCategories: ['nutty_cocoa', 'sweet'] };
const dicaprio: BeanAttributes = { roastLevelOrd: 5, acidity: 1, body: 4, decaf: true, flavorCategories: ['nutty_cocoa', 'sweet'] };
const dreamy: BeanAttributes = { roastLevelOrd: 4, acidity: 1, body: 4, decaf: true, flavorCategories: ['nutty_cocoa', 'sweet'] };
const aponte: BeanAttributes = { roastLevelOrd: 4, acidity: 2, body: 3, decaf: true, flavorCategories: ['nutty_cocoa', 'sweet'] };
const jaldoe: BeanAttributes = { roastLevelOrd: 3, acidity: 3, body: 4, flavorCategories: ['fruity', 'sweet'] };
const gujiUraga: BeanAttributes = { roastLevelOrd: 2, acidity: 4, body: 2, flavorCategories: ['fruity', 'floral'] };

const signals: TasteSignals = {
  savedBeanAttrs: [brily, dicaprio, dreamy],
  ratedBeanAttrs: [],
  likes: ['저산미', '고소함', '초콜릿/단맛', '다크 로스팅', '저녁은 디카페인'],
  dislikes: ['고산미', '라이트 로스팅'],
};

describe('deriveTasteTarget', () => {
  it('derives a low-acidity, full-body, dark target from saved beans + tags', () => {
    const t = deriveTasteTarget(signals);
    expect(t.acidity).toBeLessThanOrEqual(2);
    expect(t.body).toBeGreaterThanOrEqual(3.5);
    expect(t.roast).toBeGreaterThanOrEqual(4);
    expect(t.flavorAffinity).toEqual(expect.arrayContaining(['nutty_cocoa', 'sweet']));
    expect(t.penalize).toEqual(expect.arrayContaining(['highAcidity', 'lightRoast']));
    expect(t.confidence).not.toBe('none');
    expect(t.summary.length).toBeGreaterThan(0);
  });
  it('returns confidence none with no signals', () => {
    const t = deriveTasteTarget({ savedBeanAttrs: [], ratedBeanAttrs: [], likes: [], dislikes: [] });
    expect(t.confidence).toBe('none');
    expect(t.flavorAffinity).toEqual([]);
  });
  it('derived target numeric fields have no decimals (rendered output constraint)', () => {
    const t = deriveTasteTarget(signals);
    // roast's weighted mean is a repeating decimal (~4.6667) before rounding — this
    // asserts the output-facing field is rounded to an integer on the 1..5 scale.
    if (t.acidity != null) expect(Number.isInteger(t.acidity)).toBe(true);
    if (t.body != null) expect(Number.isInteger(t.body)).toBe(true);
    if (t.roast != null) expect(Number.isInteger(t.roast)).toBe(true);
  });
});

describe('scoreBean — §4 acceptance anchors', () => {
  const t = deriveTasteTarget(signals);
  it('brily → great', () => { expect(scoreBean(brily, t).band).toBe('great'); });
  it('aponte → great', () => { expect(scoreBean(aponte, t).band).toBe('great'); });
  it('잘 되어 가시나 → ok', () => { expect(scoreBean(jaldoe, t).band).toBe('ok'); });
  it('guji uraga → adventure', () => { expect(scoreBean(gujiUraga, t).band).toBe('adventure'); });
  it('bean with no attributes → unknown', () => {
    expect(scoreBean({}, t).band).toBe('unknown');
  });
  it('axes have no percent and include a match direction', () => {
    const s = scoreBean(brily, t);
    expect(s.axes.find((a) => a.key === 'acidity')?.match).toBe('hit');
    expect(JSON.stringify(s)).not.toMatch(/%/);
  });
  it('AxisComparison.target has no decimals', () => {
    const s = scoreBean(jaldoe, t);
    const roastAxis = s.axes.find((a) => a.key === 'roast');
    expect(typeof roastAxis?.target).toBe('number');
    expect(Number.isInteger(roastAxis?.target)).toBe(true);
  });
});

describe('scoreBean — renormalizes over available axes (partial attrs)', () => {
  const t = deriveTasteTarget(signals);
  it('bean with only acidity + flavor set scores over available axes instead of unknown', () => {
    // roast/body are null on this bean — every fixture bean elsewhere has all 4 axes set,
    // so this is the only test exercising the wsum renormalization path in scoreBean.
    const partial: BeanAttributes = { acidity: 1, flavorCategories: ['nutty_cocoa', 'sweet'] };
    const s = scoreBean(partial, t);
    expect(s.band).not.toBe('unknown');

    const acidityAxis = s.axes.find((a) => a.key === 'acidity');
    const flavorAxis = s.axes.find((a) => a.key === 'flavor');
    const roastAxis = s.axes.find((a) => a.key === 'roast');
    const bodyAxis = s.axes.find((a) => a.key === 'body');

    expect(acidityAxis?.match).not.toBe('na');
    expect(flavorAxis?.match).not.toBe('na');
    expect(roastAxis?.match).toBe('na');
    expect(bodyAxis?.match).toBe('na');
  });
});
