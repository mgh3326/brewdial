import { describe, expect, it, vi } from 'vitest';
import { createPourAudio } from './pour-audio';

interface FakeOsc {
  frequency: { value: number };
  connected: unknown[];
  startedAt: number | null;
  stoppedAt: number | null;
  start(t: number): void;
  stop(t: number): void;
  connect(node: unknown): void;
  type: OscillatorType;
}
interface FakeGain {
  gain: {
    value: number;
    setValueAtTime: (v: number, t: number) => void;
    linearRampToValueAtTime: (v: number, t: number) => void;
  };
  connected: unknown[];
  connect(node: unknown): void;
}

function makeFakeContext() {
  const oscillators: FakeOsc[] = [];
  const gains: FakeGain[] = [];
  const ctx = {
    state: 'suspended' as AudioContextState,
    currentTime: 0,
    destination: { name: 'dest' },
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => {
      ctx.state = 'closed';
    }),
    createOscillator: vi.fn(() => {
      const o: FakeOsc = {
        frequency: { value: 0 },
        connected: [],
        startedAt: null,
        stoppedAt: null,
        type: 'sine',
        start(t: number) { o.startedAt = t; },
        stop(t: number) { o.stoppedAt = t; },
        connect(node: unknown) { o.connected.push(node); }
      };
      oscillators.push(o);
      return o;
    }),
    createGain: vi.fn(() => {
      const g: FakeGain = {
        gain: {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn()
        },
        connected: [],
        connect(node: unknown) { g.connected.push(node); }
      };
      gains.push(g);
      return g;
    })
  };
  return { ctx, oscillators, gains };
}

describe('createPourAudio', () => {
  it('does not construct an AudioContext until unlock is called', () => {
    const factory = vi.fn(() => makeFakeContext().ctx as unknown as AudioContext);
    createPourAudio(factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it('unlocks the context on first call and is idempotent', async () => {
    const built = makeFakeContext();
    const factory = vi.fn(() => built.ctx as unknown as AudioContext);
    const audio = createPourAudio(factory);

    await audio.unlock();
    await audio.unlock();
    await audio.unlock();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(built.ctx.resume).toHaveBeenCalled();
    expect(audio.isReady()).toBe(true);
  });

  it('playPhaseStart schedules two 880Hz oscillators after unlock', async () => {
    const built = makeFakeContext();
    const audio = createPourAudio(() => built.ctx as unknown as AudioContext);
    await audio.unlock();
    audio.playPhaseStart();
    expect(built.oscillators.length).toBe(2);
    expect(built.oscillators[0].frequency.value).toBe(880);
    expect(built.oscillators[1].frequency.value).toBe(880);
    expect(built.oscillators[0].startedAt).not.toBeNull();
    expect(built.oscillators[0].stoppedAt).not.toBeNull();
  });

  it('playComplete schedules three descending oscillators after unlock', async () => {
    const built = makeFakeContext();
    const audio = createPourAudio(() => built.ctx as unknown as AudioContext);
    await audio.unlock();
    audio.playComplete();
    expect(built.oscillators.length).toBe(3);
    expect(built.oscillators.map((o) => o.frequency.value)).toEqual([988, 784, 523]);
  });

  it('play* are no-ops before unlock', () => {
    const built = makeFakeContext();
    const audio = createPourAudio(() => built.ctx as unknown as AudioContext);
    audio.playPhaseStart();
    audio.playComplete();
    expect(built.oscillators.length).toBe(0);
  });

  it('close() closes the context and is safe to call repeatedly', async () => {
    const built = makeFakeContext();
    const audio = createPourAudio(() => built.ctx as unknown as AudioContext);
    await audio.unlock();
    audio.close();
    audio.close();
    expect(built.ctx.close).toHaveBeenCalledTimes(1);
    expect(audio.isReady()).toBe(false);
  });
});
