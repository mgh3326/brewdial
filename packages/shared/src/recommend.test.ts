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
});
