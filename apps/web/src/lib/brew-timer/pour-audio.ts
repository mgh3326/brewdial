export interface PourAudio {
  unlock(): Promise<void>;
  playPhaseStart(): void;
  playComplete(): void;
  isReady(): boolean;
  close(): void;
}

export type AudioContextFactory = () => AudioContext;

const PEAK_GAIN = 0.25;
const ATTACK_S = 0.005;
const RELEASE_S = 0.03;
const TONE_S = 0.12;
const GAP_S = 0.05;
const COMPLETE_TONE_S = 0.18;

function defaultFactory(): AudioContext {
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) throw new Error('Web Audio API unavailable');
  return new Ctor();
}

export function createPourAudio(factory: AudioContextFactory = defaultFactory): PourAudio {
  let ctx: AudioContext | null = null;
  let unlocking: Promise<void> | null = null;
  let closed = false;
  let primed = false;

  function isReady(): boolean {
    return !!ctx && !closed && ctx.state === 'running';
  }

  // Called synchronously during unlock() so iOS WebKit sees it as gesture-driven.
  function primeSilentBuffer(): void {
    if (primed || !ctx) return;
    primed = true;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime;
      osc.start(t);
      osc.stop(t + 0.02);
    } catch {
      // older WebKit may throw on detached nodes; ignore
    }
  }

  function unlock(): Promise<void> {
    if (closed) return Promise.resolve();
    if (unlocking) return unlocking;
    // Construct and resume synchronously on the gesture task so iOS WebKit
    // treats resume() as user-initiated.
    if (!ctx) ctx = factory();
    primeSilentBuffer();
    unlocking =
      ctx.state === 'suspended'
        ? ctx.resume().catch(() => undefined)
        : Promise.resolve();
    return unlocking;
  }

  function tone(freq: number, startAt: number, duration: number): void {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, startAt + ATTACK_S);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, startAt + duration - RELEASE_S);
    gain.gain.linearRampToValueAtTime(0.0001, startAt + duration);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.01);
  }

  function playPhaseStart(): void {
    if (!isReady() || !ctx) return;
    const t0 = ctx.currentTime;
    tone(880, t0, TONE_S);
    tone(880, t0 + TONE_S + GAP_S, TONE_S);
  }

  function playComplete(): void {
    if (!isReady() || !ctx) return;
    const t0 = ctx.currentTime;
    tone(988, t0, COMPLETE_TONE_S);
    tone(784, t0 + COMPLETE_TONE_S, COMPLETE_TONE_S);
    tone(523, t0 + COMPLETE_TONE_S * 2, COMPLETE_TONE_S);
  }

  function close(): void {
    if (closed) return;
    closed = true;
    primed = false;
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {});
    }
    ctx = null;
    unlocking = null;
  }

  return { unlock, playPhaseStart, playComplete, isReady, close };
}
