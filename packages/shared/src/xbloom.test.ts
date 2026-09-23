import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { validateCreateRecipeInput } from './validation.js';
import { fromXBloomYaml, toXBloomYaml, XBloomValidationError } from './xbloom.js';

const FIXTURES = ['three-pour-spiral.yaml', 'five-pour-descend.yaml', 'grind0-no-grind.yaml'];
const loadFixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/xbloom/${name}`, import.meta.url), 'utf8');

const basePour = {
  label: 'P',
  ml: 50,
  temp_c: 90,
  pattern: 'spiral',
  pause_s: 10,
  rpm: 100,
  flow_ml_s: 3.0,
  agitation: false
};
const mkYaml = (over: Record<string, unknown> = {}, pours?: unknown[]) =>
  stringify({
    name: 'T',
    dose_g: 15,
    grind: 60,
    ratio: 16,
    pours: pours ?? [basePour, { ...basePour, label: 'P2' }],
    kind: 'custom',
    ...over
  });

describe('xBloom roundtrip fixtures (deep-equal after parse)', () => {
  for (const name of FIXTURES) {
    it(`round-trips ${name} with zero loss`, () => {
      const yamlText = loadFixture(name);
      const back = toXBloomYaml(fromXBloomYaml(yamlText));
      expect(parse(back)).toEqual(parse(yamlText));
    });

    it(`${name} produces input that passes validateCreateRecipeInput`, () => {
      const input = fromXBloomYaml(loadFixture(name));
      const r = validateCreateRecipeInput(input);
      expect(r.ok).toBe(true);
    });
  }
});

describe('fromXBloomYaml mapping', () => {
  const input = fromXBloomYaml(loadFixture('three-pour-spiral.yaml'));

  it('maps params per spec', () => {
    expect(input.method).toBe('other');
    expect(input.title).toBe('Test Ethiopia Guji');
    expect(input.beanSnapshot?.name).toBe('Test Ethiopia Guji');
    const p = input.params!;
    expect(p.doseG).toBe(16);
    expect(p.ratio).toBe('1:16');
    expect(p.waterG).toBe(256);
    expect(p.tempC).toBe(92); // first pour temp
    expect(p.brewer).toBe('Omni Dripper 2');
    expect(p.grinder).toBe('xBloom Studio');
    expect(p.targetTimeSec).toBe(172.5); // midpoint of 2:45-3:00
  });

  it('maps grind to a GrindSpec with xBloom Studio clicks', () => {
    const g = input.params!.grind;
    expect(typeof g).toBe('object');
    if (g && typeof g === 'object') {
      expect(g.perGrinder).toEqual([
        { grinder: 'xBloom Studio', clicks: 64, source: 'measured' }
      ]);
      expect(g.target.targetDrawdownSec).toBe(172.5);
    }
  });

  it('accumulates step timing: endSec = atSec + ml/flow, next atSec adds pause', () => {
    const s = input.steps!;
    expect(s[0]).toMatchObject({ atSec: 0, endSec: 12, waterG: 35, pourRateGPerSec: 3.0 });
    expect(s[1]).toMatchObject({ atSec: 52, endSec: 90, waterG: 155, pourRateGPerSec: 3.2 });
    expect(s[2]).toMatchObject({ atSec: 120, endSec: 149, waterG: 256, pourRateGPerSec: 3.5 });
  });

  it('writes human prose plus a machine tag into each step note', () => {
    expect(input.steps![0].note).toContain('Bloom');
    expect(input.steps![0].note).toContain('[label=Bloom');
    expect(input.steps![0].note).toContain('pattern=spiral');
    expect(input.steps![0].note).toContain('pause_s=40');
    // label with a space is quoted in the tag
    expect(input.steps![1].note).toContain('label="Main pour"');
  });

  it('carries the human note plus a [xbloom …] recipe tag in notes', () => {
    expect(input.notes).toContain('First dial-in [see notebook]');
    expect(input.notes).toContain('[xbloom ');
    expect(input.notes).toContain('stage_temps=110,90');
    expect(input.notes).toContain('time=2:45–3:00');
    expect(input.notes).toContain('water_ml=256');
  });
});

describe('fromXBloomYaml — water_ml absent + grind=0', () => {
  const input = fromXBloomYaml(loadFixture('grind0-no-grind.yaml'));

  it('derives waterG = round(dose*ratio) when water_ml is absent', () => {
    expect(input.params!.waterG).toBe(248); // 15 * 16.5 = 247.5 -> 248
  });

  it('maps grind=0 to empty perGrinder + 무분쇄 legacyText', () => {
    const g = input.params!.grind;
    expect(typeof g).toBe('object');
    if (g && typeof g === 'object') {
      expect(g.perGrinder).toBeUndefined();
      expect(g.legacyText).toBe('무분쇄(외부 그라인더)');
      expect(g.target.brewMethodPosition).toBe('xBloom omni dripper'); // no time -> anchor fallback
    }
    expect(input.params!.targetTimeSec).toBeUndefined();
  });
});

describe('toXBloomYaml export specifics', () => {
  it('emits the last pour pause_s from its tag (no successor to derive from)', () => {
    const out = parse(toXBloomYaml(fromXBloomYaml(loadFixture('five-pour-descend.yaml'))));
    expect(out.pours[4].pause_s).toBe(60);
    expect(out.pours[4].pattern).toBe('center');
  });

  it('keeps explicit pause_s: 0 vs absent key distinct', () => {
    const out = parse(toXBloomYaml(fromXBloomYaml(loadFixture('grind0-no-grind.yaml'))));
    expect(out.pours[0].pause_s).toBe(0);
    expect('pause_s' in out.pours[0]).toBe(true);
  });

  it('omits water_ml/time/stage_temps when absent in the source', () => {
    const out = parse(toXBloomYaml(fromXBloomYaml(loadFixture('grind0-no-grind.yaml'))));
    expect('water_ml' in out).toBe(false);
    expect('time' in out).toBe(false);
    expect('stage_temps' in out).toBe(false);
    expect(out.note).toBe('Pre-ground [medium roast]');
  });

  it('exports an authored (tag-less) recipe with format defaults', () => {
    const yamlText = toXBloomYaml({
      title: 'Authored',
      params: { doseG: 15, waterG: 240, ratio: '1:16', tempC: 92 },
      steps: [
        { atSec: 0, endSec: 15, waterG: 40, pourRateGPerSec: 3.0, note: 'Bloom' },
        { atSec: 45, endSec: 90, waterG: 240, pourRateGPerSec: 3.2, note: 'Rest' }
      ]
    });
    const out = parse(yamlText);
    expect(out.kind).toBe('custom');
    expect(out.grind).toBe(0);
    expect(out.pours[0].pattern).toBe('spiral');
    expect(out.pours[0].pause_s).toBe(30); // derived: 45 - 15
    // and it re-imports cleanly
    expect(() => fromXBloomYaml(yamlText)).not.toThrow();
  });
});

describe('validation boundaries (hardware ranges)', () => {
  it.each([
    ['grind -1', { grind: -1 }, false],
    ['grind 0 (무분쇄)', { grind: 0 }, true],
    ['grind 1', { grind: 1 }, true],
    ['grind 80', { grind: 80 }, true],
    ['grind 81', { grind: 81 }, false],
    ['grind 64.5 non-integer', { grind: 64.5 }, false],
    ['ratio 0', { ratio: 0 }, false],
    ['dose_g missing', { dose_g: undefined }, false]
  ])('%s', (_label, over, ok) => {
    const run = () => fromXBloomYaml(mkYaml(over));
    if (ok) expect(run).not.toThrow();
    else expect(run).toThrow(XBloomValidationError);
  });

  it.each([
    ['temp 39', 39, false],
    ['temp 40', 40, true],
    ['temp 95', 95, true],
    ['temp 96', 96, false]
  ])('temp_c %s', (_l, temp_c, ok) => {
    const run = () =>
      fromXBloomYaml(mkYaml({}, [{ ...basePour, temp_c }, { ...basePour, label: 'P2' }]));
    if (ok) expect(run).not.toThrow();
    else expect(run).toThrow(/temp_c/);
  });

  it.each([
    ['flow 2.9', 2.9, false],
    ['flow 3.0', 3.0, true],
    ['flow 3.5', 3.5, true],
    ['flow 3.6', 3.6, false],
    ['flow 3.05 off-step', 3.05, false]
  ])('flow_ml_s %s', (_l, flow_ml_s, ok) => {
    const run = () =>
      fromXBloomYaml(mkYaml({}, [{ ...basePour, flow_ml_s }, { ...basePour, label: 'P2' }]));
    if (ok) expect(run).not.toThrow();
    else expect(run).toThrow(/flow_ml_s/);
  });

  it.each([
    ['rpm 0', 0, true],
    ['rpm 59', 59, false],
    ['rpm 60', 60, true],
    ['rpm 65 off-step', 65, false],
    ['rpm 120', 120, true],
    ['rpm 121', 121, false]
  ])('rpm %s', (_l, rpm, ok) => {
    const run = () => fromXBloomYaml(mkYaml({}, [{ ...basePour, rpm }, { ...basePour, label: 'P2' }]));
    if (ok) expect(run).not.toThrow();
    else expect(run).toThrow(/rpm/);
  });

  it.each([
    ['pause -1', -1, false],
    ['pause 0', 0, true],
    ['pause 255', 255, true],
    ['pause 256', 256, false]
  ])('pause_s %s', (_l, pause_s, ok) => {
    const run = () =>
      fromXBloomYaml(mkYaml({}, [{ ...basePour, pause_s }, { ...basePour, label: 'P2' }]));
    if (ok) expect(run).not.toThrow();
    else expect(run).toThrow(/pause_s/);
  });

  it('rejects fewer than 2 pours', () => {
    expect(() => fromXBloomYaml(mkYaml({}, [basePour]))).toThrow(/at least 2/);
    expect(() => fromXBloomYaml(mkYaml({}, []))).toThrow(/at least 2/);
  });

  it('rejects a non-spiral/ring/center pattern', () => {
    expect(() =>
      fromXBloomYaml(mkYaml({}, [{ ...basePour, pattern: 'zigzag' }, { ...basePour, label: 'P2' }]))
    ).toThrow(/pattern/);
  });
});

describe('tag format vs human notes (no collision)', () => {
  it('leaves human bracketed text alone in recipe notes', () => {
    const out = parse(
      toXBloomYaml({
        title: 'T',
        params: { doseG: 15, ratio: '1:16', tempC: 92 },
        steps: [
          { atSec: 0, endSec: 15, waterG: 40, pourRateGPerSec: 3.0, note: 'pour [see log] gently' },
          { atSec: 45, endSec: 90, waterG: 240, pourRateGPerSec: 3.2, note: 'done' }
        ],
        notes: 'tasted great [draft v2] try [1:2] next'
      })
    );
    expect(out.note).toBe('tasted great [draft v2] try [1:2] next');
    // human bracket in step note stays inside the emitted label, not eaten as a tag
    expect(out.pours[0].label).toBe('pour [see log] gently');
  });

  it('does not treat a whitelisted-key bracket without label= as a step tag', () => {
    const out = parse(
      toXBloomYaml({
        title: 'T',
        params: { doseG: 15, ratio: '1:16', tempC: 92 },
        steps: [
          { atSec: 0, endSec: 15, waterG: 40, pourRateGPerSec: 3.0, note: 'noted [temp_c=90]' },
          { atSec: 45, endSec: 90, waterG: 240, pourRateGPerSec: 3.2, note: 'done' }
        ]
      })
    );
    // [temp_c=90] lacks label= -> stays human text, lands inside label verbatim
    expect(out.pours[0].label).toBe('noted [temp_c=90]');
  });
});
