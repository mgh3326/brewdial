// Self-contained Web Audio tone player for the Apps-in-Toss WebView spike.
// Mirrors the proven BrewDial unlock pattern: create/resume the AudioContext
// synchronously inside the user-gesture call, prime a silent buffer so iOS
// WebKit treats audio as gesture-activated, then schedule tones on the audio
// clock (AudioContext.currentTime) so they still fire after the screen locks.
//
// This module has NO dependency on the Apps-in-Toss SDK, so the audio probe
// always builds and runs even outside the Toss WebView.

const PEAK_GAIN = 0.25;
const ATTACK_S = 0.005;
const RELEASE_S = 0.03;
const TONE_S = 0.12;

type AudioCtor = typeof AudioContext;

function makeContext(): AudioContext {
  const Ctor: AudioCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API unavailable');
  return new Ctor();
}

let ctx: AudioContext | null = null;
let primed = false;

export function audioState(): string {
  return ctx ? ctx.state : 'none';
}

export function isReady(): boolean {
  return !!ctx && ctx.state === 'running';
}

// Must be called from a real user gesture (tap) so WebKit unlocks audio.
export async function unlock(): Promise<void> {
  if (!ctx) ctx = makeContext();
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      // ignore; some hosts resume lazily on first scheduled node
    }
  }
  if (!primed) {
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
      // older WebKit can throw on detached nodes; safe to ignore
    }
  }
}

function beep(freq: number, atSec: number, durS = TONE_S): void {
  if (!ctx) return;
  const start = ctx.currentTime + Math.max(0, atSec);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + ATTACK_S);
  gain.gain.setValueAtTime(PEAK_GAIN, start + durS - RELEASE_S);
  gain.gain.linearRampToValueAtTime(0, start + durS);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durS + 0.05);
}

// Immediate confirmation beep.
export function playNow(): void {
  beep(880, 0);
}

// Schedule a "phase start" ack now plus a two-tone "complete" cue `seconds`
// later. Use this to lock the screen and confirm the scheduled tone still
// fires while the WebView is backgrounded/locked.
export function scheduleIn(seconds: number): void {
  beep(660, 0);
  beep(880, seconds);
  beep(988, seconds + 0.18);
}
