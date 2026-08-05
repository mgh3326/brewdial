import { describe, expect, it } from 'vitest';
import { suggestDripperAdaptation, type DripperInfo } from './dripper.js';

const V60: DripperInfo = {
  name: 'Hario V60',
  class: 'bed_restricted',
  continuumPosition: 0.1,
  recommendedDoseRange: { minG: 12, maxG: 30 }
};
const KALITA: DripperInfo = {
  name: 'Kalita Wave 185',
  class: 'dripper_restricted',
  continuumPosition: 0.85,
  recommendedDoseRange: { minG: 15, maxG: 35 }
};
const ORIGAMI: DripperInfo = {
  name: 'Origami',
  class: 'hybrid',
  continuumPosition: 0.05,
  recommendedDoseRange: { minG: 12, maxG: 30 }
};
const CHEMEX: DripperInfo = {
  name: 'Chemex',
  class: 'bed_restricted',
  continuumPosition: 0.5,
  recommendedDoseRange: { minG: 30, maxG: 70 }
};

describe('suggestDripperAdaptation (ROB-612)', () => {
  it('V60 → Kalita (more dripper-restricted): coarser + fewer pours', () => {
    const a = suggestDripperAdaptation(V60, 20, KALITA);
    expect(a.grindShift).toBe('coarser');
    expect(a.pourShift).toBe('fewer_pours');
    expect(a.sizeMatch).toBe('ok');
    expect(a.bedOverflow).toBe(false);
    expect(a.confidence).toBe('medium'); // cross-class heuristic
    expect(a.disclaimer).not.toBe('');
  });

  it('V60 → Origami (faster, near 1:1): no grind direction', () => {
    const a = suggestDripperAdaptation(V60, 20, ORIGAMI);
    expect(a.grindShift).toBe('none');
    expect(a.pourShift).toBe('none');
  });

  it('★ 40g dose over a Kalita 185 → oversized + bed overflow warning + low confidence', () => {
    const a = suggestDripperAdaptation(V60, 40, KALITA);
    expect(a.sizeMatch).toBe('oversized');
    expect(a.bedOverflow).toBe(true);
    expect(a.bedDepthShift).toBe('deeper');
    expect(a.warn).toMatch(/초과/);
    expect(a.confidence).toBe('low');
  });

  it('V60 → Chemex (same class, well-sized at 40g): coarser, high confidence', () => {
    const a = suggestDripperAdaptation(V60, 40, CHEMEX); // Chemex range 30–70g
    expect(a.grindShift).toBe('coarser'); // delta 0.40 (thick paper slows)
    expect(a.sizeMatch).toBe('ok');
    expect(a.confidence).toBe('high'); // same class + size ok
  });

  it('Chemex is undersized below its 30g minimum', () => {
    const a = suggestDripperAdaptation(V60, 20, CHEMEX);
    expect(a.sizeMatch).toBe('undersized');
    expect(a.bedDepthShift).toBe('shallower');
  });
});
