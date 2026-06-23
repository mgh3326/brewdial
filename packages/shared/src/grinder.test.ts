import { describe, expect, it } from 'vitest';
import { parseClicks, suggestGrinderClicks, type GrinderInfo } from './grinder.js';
import type { GrindSpec } from './types.js';

const REGISTRY: GrinderInfo[] = [
  { name: 'KINGrinder K6', stepless: false, brewMethodRanges: { v60: { from: 90, to: 108 } } },
  { name: 'Comandante C40', stepless: false, brewMethodRanges: { v60: { from: 22, to: 30 } } },
  { name: '1Zpresso J-Max', stepless: true, brewMethodRanges: {} }
];

const k6 = REGISTRY[0];
const comandante = REGISTRY[1];
const jmax = REGISTRY[2];

describe('parseClicks', () => {
  it('parses numbers, ranges, and rev strings; null on garbage', () => {
    expect(parseClicks(102)).toBe(102);
    expect(parseClicks('25-28')).toBe(26.5);
    expect(parseClicks('1.5 rev')).toBe(1.5);
    expect(parseClicks('coarse')).toBeNull();
    expect(parseClicks(undefined)).toBeNull();
  });
});

describe('suggestGrinderClicks (ROB-611)', () => {
  it('returns measured clicks verbatim when the grinder is already listed', () => {
    const grind: GrindSpec = {
      target: { brewMethodPosition: 'v60 medium' },
      perGrinder: [{ grinder: 'KINGrinder K6', clicks: 102, source: 'measured' }]
    };
    const s = suggestGrinderClicks(grind, 'v60', k6, REGISTRY);
    expect(s.clicks).toBe(102);
    expect(s.basis).toBe('measured');
    expect(s.source).toBe('measured');
    expect(s.disclaimer).toBe('');
  });

  it('interpolates clicks for a new grinder via relative band position', () => {
    const grind: GrindSpec = {
      target: { brewMethodPosition: 'v60 medium', targetDrawdownSec: 265 },
      perGrinder: [{ grinder: 'KINGrinder K6', clicks: 102, source: 'measured' }]
    };
    // pos = (102-90)/(108-90) = 0.667 → Comandante 22 + 0.667*8 ≈ 27
    const s = suggestGrinderClicks(grind, 'v60', comandante, REGISTRY);
    expect(s.basis).toBe('relative-band');
    expect(s.source).toBe('dial-in-start');
    expect(s.clicks).toBe(27);
    expect(s.range).toEqual({ from: 25, to: 29 });
    expect(s.disclaimer).not.toBe('');
  });

  it('falls back to the band midpoint when there is no usable reference', () => {
    const grind: GrindSpec = { target: { brewMethodPosition: 'v60 medium' } };
    const s = suggestGrinderClicks(grind, 'v60', k6, REGISTRY);
    expect(s.basis).toBe('band-midpoint');
    expect(s.clicks).toBe(99); // (90+108)/2
    expect(s.source).toBe('dial-in-start');
  });

  it('returns null clicks when the grinder has no band and is not measured', () => {
    const grind: GrindSpec = {
      target: { brewMethodPosition: 'v60 medium' },
      perGrinder: [{ grinder: 'KINGrinder K6', clicks: 102, source: 'measured' }]
    };
    const s = suggestGrinderClicks(grind, 'v60', jmax, REGISTRY);
    expect(s.clicks).toBeNull();
    expect(s.basis).toBe('none');
    expect(s.source).toBe('unknown');
  });
});
