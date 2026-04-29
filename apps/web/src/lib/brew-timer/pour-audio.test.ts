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
    resume: vi.fn(() => {
      ctx.state = 'running';
      return Promise.resolve();
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

  it('constructs the context and calls resume synchronously on first unlock', () => {
    const built = makeFakeContext();
    const factory = vi.fn(() => built.ctx as unknown as AudioContext);
    const audio = createPourAudio(factory);
    const p = audio.unlock(); // do NOT await yet
    expect(factory).toHaveBeenCalledTimes(1);
    expect(built.ctx.resume).toHaveBeenCalledTimes(1);
    expect(p).toBeInstanceOf(Promise);
  });

  it('unlock is idempotent — factory and resume called once across multiple calls', async () => {
    const built = makeFakeContext();
    const factory = vi.fn(() => built.ctx as unknown as AudioContext);
    const audio = createPourAudio(factory);

    await audio.unlock();
    await audio.unlock();
    await audio.unlock();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(built.ctx.resume).toHaveBeenCalledTimes(1);
    expect(audio.isReady()).toBe(true);
  });

  it('schedules one silent priming oscillator on first unlock only', async () => {
    const built = makeFakeContext();
    const audio = createPourAudio(() => built.ctx as unknown as AudioContext);
    await audio.unlock();
    await audio.unlock();
    // Only the silent prime, no phase tones yet
    expect(built.oscillators.length).toBe(1);
    expect(built.gains[0].gain.value).toBe(0);
  });

  it('playPhaseStart schedules two 880Hz oscillators after unlock (plus one silent prime)', async () => {
    const built = makeFakeContext();
    const audio = createPourAudio(() => built.ctx as unknown as AudioContext);
    await audio.unlock();
    audio.playPhaseStart();
    // 1 silent prime + 2 phase-start tones
    expect(built.oscillators.length).toBe(3);
    const tones = built.oscillators.slice(1);
    expect(tones[0].frequency.value).toBe(880);
    expect(tones[1].frequency.value).toBe(880);
    expect(tones[0].startedAt).not.toBeNull();
    expect(tones[0].stoppedAt).not.toBeNull();
  });

  it('playComplete schedules three descending oscillators after unlock (plus one silent prime)', async () => {
    const built = makeFakeContext();
    const audio = createPourAudio(() => built.ctx as unknown as AudioContext);
    await audio.unlock();
    audio.playComplete();
    // 1 silent prime + 3 completion tones
    expect(built.oscillators.length).toBe(4);
    expect(built.oscillators.slice(1).map((o) => o.frequency.value)).toEqual([988, 784, 523]);
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

  it('close() resets so a new instance primes again', async () => {
    const built1 = makeFakeContext();
    const a1 = createPourAudio(() => built1.ctx as unknown as AudioContext);
    await a1.unlock();
    a1.close();
    const built2 = makeFakeContext();
    const a2 = createPourAudio(() => built2.ctx as unknown as AudioContext);
    await a2.unlock();
    // New instance gets its own prime
    expect(built2.oscillators.length).toBe(1);
  });
});
