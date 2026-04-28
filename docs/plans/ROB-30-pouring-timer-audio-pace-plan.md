# ROB-30 BrewDial Pouring Timer: Audio Pace Plan

> **For agentic workers:** Implement this plan task-by-task with strict TDD. For each task: write the failing test FIRST, run it to confirm it fails, write the minimal implementation, run the test to confirm it passes, commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BrewDial recipe-detail Pouring timer useful during a real brew by adding (1) audible cues for phase starts and completion via the Web Audio API, (2) a live "지금쯤 약 Xg" expected-water value computed by linear interpolation within the current phase, (3) a current-phase progress bar, and (4) rounded display values (default nearest 10g) so the water number does not visually twitch every second.

**Architecture:** All time/water math lives as pure functions in `apps/web/src/lib/brew-timer/pour-schedule.ts` (extend existing module — do NOT create a parallel one). Two small sibling modules are introduced: `sound-preference.ts` (localStorage read/write only) and `pour-audio.ts` (Web Audio API wrapper with an injectable `AudioContext` factory so it is unit-testable under Vitest+jsdom). The recipe-detail Svelte page (`apps/web/src/routes/recipes/[code]/+page.svelte`) consumes these modules; it computes derived state with `$derived`, persists user sound preference, and lazily unlocks the `AudioContext` on the first user gesture (`Start brew` or the new `사운드 테스트` button). Existing browser Notification + `navigator.vibrate` cues are preserved as secondary alerts.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, TypeScript, Web Audio API, Vitest with jsdom.

**Out of scope (Non-goals — DO NOT touch):** Bluetooth scale integration; manual actual-water entry; brew-log persistence; PWA / service-worker background timer; mp3/wav/custom sound picker; any change to the BrewDial prod path under `/Users/mgh3326/services/brewdial`; GitHub SSH deploy automation.

**Validation (run from repo root after every meaningful change):**
```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm lint
```

---

## File Structure

- **Modify:** `apps/web/src/lib/brew-timer/pour-schedule.ts`
  - Add: `getPhaseStartWaterG`, `getCurrentPhase`, `getExpectedWaterG`, `roundToStep`, `getPhaseProgressRatio`.
  - Keep existing exports (`PourPhase`, `PourSchedule`, `formatSeconds`, `buildPourSchedule`) backward-compatible.
- **Modify:** `apps/web/src/lib/brew-timer/pour-schedule.test.ts`
  - Add `describe` blocks for each new helper.
- **Create:** `apps/web/src/lib/brew-timer/sound-preference.ts`
  - LocalStorage read/write of a single boolean key.
- **Create:** `apps/web/src/lib/brew-timer/sound-preference.test.ts`
- **Create:** `apps/web/src/lib/brew-timer/pour-audio.ts`
  - Web Audio API wrapper, factory-injected `AudioContext` for testability.
- **Create:** `apps/web/src/lib/brew-timer/pour-audio.test.ts`
- **Modify:** `apps/web/src/routes/recipes/[code]/+page.svelte`
  - Wire all of the above into UI; add live expected water, target line, progress bar, sound toggle, test sound button.

---

## Behavioral Specification (use this as the source of truth for tests)

### `getPhaseStartWaterG(schedule, phaseIndex): number`
The cumulative target water (in grams) at which the given phase BEGINS pouring.
- For `phaseIndex === 0`, returns `0` (a brew always begins from an empty bed of grounds at 0 g cumulative).
- For `phaseIndex > 0`, returns the `targetWaterG` of the most recent earlier phase that has a numeric `targetWaterG`. If no earlier phase has a numeric target, returns `0`.
- For an out-of-range index (`< 0` or `>= schedule.phases.length`), returns `0`.

### `getCurrentPhase(schedule, elapsedSec): PourPhase | null`
- Returns the phase satisfying `startSec <= elapsedSec < endSec`.
- Once `elapsedSec >= schedule.totalSec`, returns `null` (the brew is done — used by the page to decide whether to show "지금쯤" guidance at all).
- If `elapsedSec` is negative or there are no phases, returns `null`.

### `getExpectedWaterG(schedule, elapsedSec): number | undefined`
Linear interpolation of cumulative water across the CURRENT phase.
- If `getCurrentPhase` returns `null`, returns `undefined`.
- If the current phase has no numeric `targetWaterG`, returns `undefined` (cannot interpolate).
- Let `start = getPhaseStartWaterG(schedule, phase.index)` and `target = phase.targetWaterG`.
- Let `span = phase.endSec - phase.startSec`. If `span <= 0`, return `target`.
- `ratio = clamp((elapsedSec - phase.startSec) / span, 0, 1)`.
- Return `start + ratio * (target - start)` as a non-rounded number (the caller rounds for display).
- Examples (from issue): for phase `0:00–0:45 · 80g까지` →
  - `elapsedSec=0` → 0
  - `elapsedSec=22.5` → 40
  - `elapsedSec=45` → 80 (boundary; in practice the next phase claims 45)
- For phase `0:45–1:45 · 230g까지` (with prev cumulative 80) → at `elapsedSec=75` (halfway) → 80 + 0.5 × (230 − 80) = 155.

### `roundToStep(grams, stepG = 10): number`
- Returns `Math.round(grams / stepG) * stepG`.
- For non-finite or negative `grams`, returns `0`.
- For non-finite or non-positive `stepG`, falls back to `stepG = 1` (i.e. just `Math.round(grams)`).
- Examples: `roundToStep(40)` → 40; `roundToStep(53.3)` → 50; `roundToStep(57)` → 60; `roundToStep(155, 5)` → 155; `roundToStep(157, 5)` → 155; `roundToStep(158, 5)` → 160.

### `getPhaseProgressRatio(schedule, elapsedSec): number`
- Returns a value in `[0, 1]` representing how far through the current phase we are.
- If `getCurrentPhase` returns `null`, returns `0` when `elapsedSec <= 0`, else `1` (used by the page to render the bar as fully filled at completion).
- If `phase.endSec === phase.startSec`, returns `1`.
- Otherwise returns `clamp((elapsedSec - phase.startSec) / (phase.endSec - phase.startSec), 0, 1)`.

### `sound-preference.ts`
- Storage key: `brewdial.timer.soundEnabled`.
- `loadSoundPreference(): boolean` — returns `true` (default) if `localStorage` is unavailable, the key is missing, or the stored value is anything other than the literal string `"false"`. Returns `false` only when the stored value is exactly `"false"`.
- `saveSoundPreference(enabled: boolean): void` — writes `"true"` or `"false"`. Silently no-ops if `localStorage` is unavailable or throws (e.g. private mode, quota).

### `pour-audio.ts`
- Public type:
  ```ts
  export interface PourAudio {
    unlock(): Promise<void>;
    playPhaseStart(): void;
    playComplete(): void;
    isReady(): boolean;
    close(): void;
  }
  export type AudioContextFactory = () => AudioContext;
  export function createPourAudio(factory?: AudioContextFactory): PourAudio;
  ```
- The factory defaults to `() => new (window.AudioContext ?? (window as any).webkitAudioContext)()` (lazy, only constructed inside `unlock()`).
- `unlock()` — constructs the `AudioContext` on first call (so it is always tied to a user gesture); if the context is `suspended`, awaits `resume()`. Subsequent calls are idempotent — returns the same in-flight or resolved promise.
- `playPhaseStart()` — emits a short two-tone cue: 880 Hz sine, 120 ms; 50 ms gap; 880 Hz sine, 120 ms. Each tone uses a gain envelope: ramp 0 → 0.25 over 5 ms, hold, then ramp to 0.0001 over the last 30 ms (to avoid clicks). No-op if `isReady()` is false.
- `playComplete()` — distinct three-tone descending arpeggio: 988 Hz → 784 Hz → 523 Hz, 180 ms each, contiguous, same envelope shape. No-op if `isReady()` is false.
- `isReady()` — true after `unlock()` resolves and context state is `running`.
- `close()` — calls `context.close()` if open; safe to call multiple times; clears internal refs.
- Tests inject a mock `AudioContextFactory` that returns a fake context recording `createOscillator()` / `createGain()` / `connect()` / `start()` / `stop()` / `frequency.value` / `gain.gain.linearRampToValueAtTime` calls so we can assert frequencies and that two oscillators are scheduled for `playPhaseStart`, three for `playComplete`.

### Page integration (`+page.svelte`)
- New state:
  - `soundEnabled = $state(true)` — initialized in `onMount` from `loadSoundPreference()`.
  - A non-reactive `pourAudio` reference (assigned in `onMount` via `createPourAudio()`).
- New `$derived` values:
  - `expectedWaterG` (number | undefined) → `getExpectedWaterG(pourSchedule, elapsedSec)`.
  - `roundedExpectedG` → `expectedWaterG === undefined ? undefined : roundToStep(expectedWaterG)`.
  - `phaseProgressPct` → `Math.round(getPhaseProgressRatio(pourSchedule, elapsedSec) * 100)`.
- UI additions inside the existing `.brew-timer` `<section>`:
  - When the timer is not done AND `currentPhase?.targetWaterG !== undefined`:
    - Line 1: `지금쯤 약 {roundedExpectedG}g` (large, monospace).
    - Line 2: `목표: {currentPhase.endLabel}까지 {currentPhase.targetWaterG}g`.
  - Below that, a progress bar with `role="progressbar"`, `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=100`, with an inner fill whose `style="width: {phaseProgressPct}%"`.
  - In the existing button row, add: a `<label><input type="checkbox" bind:checked={soundEnabled} onchange=... />사운드</label>` and a `<button>사운드 테스트</button>`.
- Behaviour wiring:
  - Inside `startTimer()`: also call `pourAudio.unlock()` (fire-and-forget) and, if `soundEnabled`, schedule `pourAudio.playPhaseStart()` for the current phase if it is the first announce.
  - Inside the existing 1-second tick: when `phase.index !== lastAnnouncedPhase`, in addition to the existing `announcePhase`, call `pourAudio.playPhaseStart()` if `soundEnabled`.
  - When the timer crosses `elapsedSec >= pourSchedule.totalSec` for the first time (i.e. on the tick where `isTimerRunning` flips to `false` due to completion), call `pourAudio.playComplete()` if `soundEnabled`. Use a one-shot guard `let completionAnnounced = $state(false)` reset by `resetTimer()`.
  - The sound checkbox's `onchange` calls `saveSoundPreference(soundEnabled)`. When the user enables sound, also call `pourAudio.unlock()` (this counts as a user gesture).
  - The 사운드 테스트 button calls `pourAudio.unlock().then(() => pourAudio.playPhaseStart())`.
- Dark-mode/mobile readability: progress bar uses existing CSS variables (`--surface-muted` for track, `--accent-strong` for fill, `--radius` for corners). Live water line uses the same monospace font as `.timer-display` but ~half the size.

---

## Tasks

### Task 1: Add `roundToStep` helper (TDD)

**Files:**
- Modify: `apps/web/src/lib/brew-timer/pour-schedule.ts`
- Test: `apps/web/src/lib/brew-timer/pour-schedule.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `pour-schedule.test.ts`:

```ts
import { roundToStep } from './pour-schedule';

describe('roundToStep', () => {
  it('rounds to the nearest 10g by default', () => {
    expect(roundToStep(0)).toBe(0);
    expect(roundToStep(40)).toBe(40);
    expect(roundToStep(53.3)).toBe(50);
    expect(roundToStep(57)).toBe(60);
    expect(roundToStep(155)).toBe(160); // 15.5 rounds up via banker's-free Math.round
  });

  it('respects a custom step', () => {
    expect(roundToStep(157, 5)).toBe(155);
    expect(roundToStep(158, 5)).toBe(160);
    expect(roundToStep(40, 1)).toBe(40);
  });

  it('clamps invalid input to 0 and falls back stepG to 1', () => {
    expect(roundToStep(Number.NaN)).toBe(0);
    expect(roundToStep(-3)).toBe(0);
    expect(roundToStep(53.3, 0)).toBe(53);
    expect(roundToStep(53.3, Number.NaN)).toBe(53);
  });
});
```

Note: the `155 → 160` case is intentional: `Math.round(155/10) === 16`. If the implementer is surprised, this is the documented contract.

- [ ] **Step 2: Run tests and confirm they fail**

```bash
pnpm --filter @brewdial/web test -- pour-schedule
```
Expected: FAIL with `roundToStep is not exported`.

- [ ] **Step 3: Implement `roundToStep`**

Append to `pour-schedule.ts`:

```ts
export function roundToStep(grams: number, stepG = 10): number {
  if (!Number.isFinite(grams) || grams < 0) return 0;
  const step = Number.isFinite(stepG) && stepG > 0 ? stepG : 1;
  return Math.round(grams / step) * step;
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm --filter @brewdial/web test -- pour-schedule
```
Expected: all `roundToStep` tests PASS, existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/brew-timer/pour-schedule.ts apps/web/src/lib/brew-timer/pour-schedule.test.ts
git commit -m "feat(brew-timer): add roundToStep helper for display rounding"
```

---

### Task 2: Add `getPhaseStartWaterG` helper (TDD)

**Files:**
- Modify: `apps/web/src/lib/brew-timer/pour-schedule.ts`
- Test: `apps/web/src/lib/brew-timer/pour-schedule.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `pour-schedule.test.ts`:

```ts
import { buildPourSchedule, getPhaseStartWaterG } from './pour-schedule';

describe('getPhaseStartWaterG', () => {
  const schedule = buildPourSchedule(recipe());

  it('returns 0 for the first phase', () => {
    expect(getPhaseStartWaterG(schedule, 0)).toBe(0);
  });

  it('returns the previous phase cumulative target for later phases', () => {
    expect(getPhaseStartWaterG(schedule, 1)).toBe(80);
    expect(getPhaseStartWaterG(schedule, 2)).toBe(230);
    expect(getPhaseStartWaterG(schedule, 3)).toBe(380);
    expect(getPhaseStartWaterG(schedule, 4)).toBe(500);
  });

  it('falls back to the most recent earlier phase that has a target', () => {
    const sparse = buildPourSchedule(recipe({
      steps: [
        { atSec: 0, waterG: 60, note: 'Bloom' },
        { atSec: 30, note: 'Continue' }, // no waterG
        { atSec: 60, waterG: 200, note: 'Pour' }
      ],
      params: { targetTimeSec: 120 }
    }));
    expect(getPhaseStartWaterG(sparse, 0)).toBe(0);
    expect(getPhaseStartWaterG(sparse, 1)).toBe(60);
    expect(getPhaseStartWaterG(sparse, 2)).toBe(60);
  });

  it('returns 0 for out-of-range indices', () => {
    expect(getPhaseStartWaterG(schedule, -1)).toBe(0);
    expect(getPhaseStartWaterG(schedule, 999)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
pnpm --filter @brewdial/web test -- pour-schedule
```

- [ ] **Step 3: Implement `getPhaseStartWaterG`**

Append to `pour-schedule.ts`:

```ts
export function getPhaseStartWaterG(schedule: PourSchedule, phaseIndex: number): number {
  if (phaseIndex <= 0 || phaseIndex >= schedule.phases.length) return 0;
  for (let i = phaseIndex - 1; i >= 0; i--) {
    const w = schedule.phases[i].targetWaterG;
    if (typeof w === 'number' && Number.isFinite(w)) return w;
  }
  return 0;
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm --filter @brewdial/web test -- pour-schedule
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/brew-timer/pour-schedule.ts apps/web/src/lib/brew-timer/pour-schedule.test.ts
git commit -m "feat(brew-timer): add getPhaseStartWaterG helper"
```

---

### Task 3: Add `getCurrentPhase` helper (TDD)

**Files:**
- Modify: `apps/web/src/lib/brew-timer/pour-schedule.ts`
- Test: `apps/web/src/lib/brew-timer/pour-schedule.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { buildPourSchedule, getCurrentPhase } from './pour-schedule';

describe('getCurrentPhase', () => {
  const schedule = buildPourSchedule(recipe());

  it('returns the phase whose half-open range contains elapsedSec', () => {
    expect(getCurrentPhase(schedule, 0)?.index).toBe(0);
    expect(getCurrentPhase(schedule, 22)?.index).toBe(0);
    expect(getCurrentPhase(schedule, 44)?.index).toBe(0);
    expect(getCurrentPhase(schedule, 45)?.index).toBe(1);
    expect(getCurrentPhase(schedule, 104)?.index).toBe(1);
    expect(getCurrentPhase(schedule, 105)?.index).toBe(2);
    expect(getCurrentPhase(schedule, 219)?.index).toBe(3);
    expect(getCurrentPhase(schedule, 220)?.index).toBe(4);
  });

  it('returns null at or past totalSec', () => {
    expect(getCurrentPhase(schedule, 270)).toBeNull();
    expect(getCurrentPhase(schedule, 9999)).toBeNull();
  });

  it('returns null for negative or empty input', () => {
    expect(getCurrentPhase(schedule, -1)).toBeNull();
    expect(getCurrentPhase({ totalSec: 0, phases: [] }, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
pnpm --filter @brewdial/web test -- pour-schedule
```

- [ ] **Step 3: Implement `getCurrentPhase`**

```ts
export function getCurrentPhase(schedule: PourSchedule, elapsedSec: number): PourPhase | null {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return null;
  if (elapsedSec >= schedule.totalSec) return null;
  return (
    schedule.phases.find(
      (phase) => elapsedSec >= phase.startSec && elapsedSec < phase.endSec
    ) ?? null
  );
}
```

- [ ] **Step 4: Run tests, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/brew-timer/pour-schedule.ts apps/web/src/lib/brew-timer/pour-schedule.test.ts
git commit -m "feat(brew-timer): add getCurrentPhase helper"
```

---

### Task 4: Add `getExpectedWaterG` helper (TDD)

**Files:**
- Modify: `apps/web/src/lib/brew-timer/pour-schedule.ts`
- Test: `apps/web/src/lib/brew-timer/pour-schedule.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { buildPourSchedule, getExpectedWaterG } from './pour-schedule';

describe('getExpectedWaterG', () => {
  const schedule = buildPourSchedule(recipe());

  it('linearly interpolates within the first phase from 0 to its target', () => {
    expect(getExpectedWaterG(schedule, 0)).toBe(0);
    expect(getExpectedWaterG(schedule, 22.5)).toBeCloseTo(40, 6);
    expect(getExpectedWaterG(schedule, 30)).toBeCloseTo((30 / 45) * 80, 6);
    expect(getExpectedWaterG(schedule, 44)).toBeCloseTo((44 / 45) * 80, 6);
  });

  it('starts later phases from the previous cumulative target', () => {
    // phase 1: 0:45–1:45, prev=80, target=230
    expect(getExpectedWaterG(schedule, 45)).toBeCloseTo(80, 6);
    expect(getExpectedWaterG(schedule, 75)).toBeCloseTo(80 + 0.5 * (230 - 80), 6); // 155
  });

  it('returns undefined past totalSec', () => {
    expect(getExpectedWaterG(schedule, 270)).toBeUndefined();
    expect(getExpectedWaterG(schedule, 9999)).toBeUndefined();
  });

  it('returns undefined when current phase has no targetWaterG', () => {
    const sparse = buildPourSchedule(recipe({
      steps: [
        { atSec: 0, waterG: 60, note: 'Bloom' },
        { atSec: 30, note: 'Continue' }
      ],
      params: { targetTimeSec: 60 }
    }));
    // phase 0 has target → defined
    expect(getExpectedWaterG(sparse, 15)).toBeCloseTo(30, 6);
    // phase 1 has no target → undefined
    expect(getExpectedWaterG(sparse, 45)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

- [ ] **Step 3: Implement `getExpectedWaterG`**

```ts
export function getExpectedWaterG(
  schedule: PourSchedule,
  elapsedSec: number
): number | undefined {
  const phase = getCurrentPhase(schedule, elapsedSec);
  if (!phase) return undefined;
  const target = phase.targetWaterG;
  if (typeof target !== 'number' || !Number.isFinite(target)) return undefined;
  const start = getPhaseStartWaterG(schedule, phase.index);
  const span = phase.endSec - phase.startSec;
  if (span <= 0) return target;
  const ratio = Math.max(0, Math.min(1, (elapsedSec - phase.startSec) / span));
  return start + ratio * (target - start);
}
```

- [ ] **Step 4: Run tests, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/brew-timer/pour-schedule.ts apps/web/src/lib/brew-timer/pour-schedule.test.ts
git commit -m "feat(brew-timer): add getExpectedWaterG linear interpolation"
```

---

### Task 5: Add `getPhaseProgressRatio` helper (TDD)

**Files:**
- Modify: `apps/web/src/lib/brew-timer/pour-schedule.ts`
- Test: `apps/web/src/lib/brew-timer/pour-schedule.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { buildPourSchedule, getPhaseProgressRatio } from './pour-schedule';

describe('getPhaseProgressRatio', () => {
  const schedule = buildPourSchedule(recipe());

  it('returns 0..1 within the current phase', () => {
    expect(getPhaseProgressRatio(schedule, 0)).toBeCloseTo(0, 6);
    expect(getPhaseProgressRatio(schedule, 22.5)).toBeCloseTo(0.5, 6);
    expect(getPhaseProgressRatio(schedule, 45)).toBeCloseTo(0, 6); // start of phase 1
    expect(getPhaseProgressRatio(schedule, 75)).toBeCloseTo(0.5, 6); // mid phase 1 (45..105)
  });

  it('returns 1 once the brew is finished', () => {
    expect(getPhaseProgressRatio(schedule, 270)).toBe(1);
    expect(getPhaseProgressRatio(schedule, 9999)).toBe(1);
  });

  it('returns 0 for negative input', () => {
    expect(getPhaseProgressRatio(schedule, -5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

- [ ] **Step 3: Implement `getPhaseProgressRatio`**

```ts
export function getPhaseProgressRatio(schedule: PourSchedule, elapsedSec: number): number {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return 0;
  const phase = getCurrentPhase(schedule, elapsedSec);
  if (!phase) return elapsedSec <= 0 ? 0 : 1;
  const span = phase.endSec - phase.startSec;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (elapsedSec - phase.startSec) / span));
}
```

- [ ] **Step 4: Run tests, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/brew-timer/pour-schedule.ts apps/web/src/lib/brew-timer/pour-schedule.test.ts
git commit -m "feat(brew-timer): add getPhaseProgressRatio helper"
```

---

### Task 6: Add `sound-preference.ts` module (TDD)

**Files:**
- Create: `apps/web/src/lib/brew-timer/sound-preference.ts`
- Create: `apps/web/src/lib/brew-timer/sound-preference.test.ts`

- [ ] **Step 1: Write failing tests**

Create `sound-preference.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSoundPreference, saveSoundPreference, SOUND_PREF_KEY } from './sound-preference';

describe('sound-preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to true when nothing is stored', () => {
    expect(loadSoundPreference()).toBe(true);
  });

  it('returns false only when the stored value is exactly "false"', () => {
    localStorage.setItem(SOUND_PREF_KEY, 'false');
    expect(loadSoundPreference()).toBe(false);

    localStorage.setItem(SOUND_PREF_KEY, 'true');
    expect(loadSoundPreference()).toBe(true);

    localStorage.setItem(SOUND_PREF_KEY, 'garbage');
    expect(loadSoundPreference()).toBe(true);
  });

  it('persists boolean values', () => {
    saveSoundPreference(false);
    expect(localStorage.getItem(SOUND_PREF_KEY)).toBe('false');
    saveSoundPreference(true);
    expect(localStorage.getItem(SOUND_PREF_KEY)).toBe('true');
  });

  it('survives a setItem that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveSoundPreference(true)).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it('returns true when localStorage access throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadSoundPreference()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
pnpm --filter @brewdial/web test -- sound-preference
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `sound-preference.ts`**

Create `sound-preference.ts`:

```ts
export const SOUND_PREF_KEY = 'brewdial.timer.soundEnabled';

export function loadSoundPreference(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveSoundPreference(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore quota / private mode failures
  }
}
```

- [ ] **Step 4: Verify Vitest config provides jsdom for this file**

Check `apps/web/vitest.config.*` (or `vite.config.*`). If `environment` is not set to `jsdom`, either set it globally or add a top-of-file pragma:
```ts
// @vitest-environment jsdom
```
Then re-run tests.

- [ ] **Step 5: Run tests, confirm pass**

```bash
pnpm --filter @brewdial/web test -- sound-preference
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/brew-timer/sound-preference.ts apps/web/src/lib/brew-timer/sound-preference.test.ts
git commit -m "feat(brew-timer): persist timer sound preference in localStorage"
```

---

### Task 7: Add `pour-audio.ts` Web Audio wrapper (TDD)

**Files:**
- Create: `apps/web/src/lib/brew-timer/pour-audio.ts`
- Create: `apps/web/src/lib/brew-timer/pour-audio.test.ts`

- [ ] **Step 1: Write failing tests**

Create `pour-audio.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
pnpm --filter @brewdial/web test -- pour-audio
```

- [ ] **Step 3: Implement `pour-audio.ts`**

Create `pour-audio.ts`:

```ts
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
      ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) throw new Error('Web Audio API unavailable');
  return new Ctor();
}

export function createPourAudio(factory: AudioContextFactory = defaultFactory): PourAudio {
  let ctx: AudioContext | null = null;
  let unlocking: Promise<void> | null = null;
  let closed = false;

  function isReady(): boolean {
    return !!ctx && !closed && ctx.state === 'running';
  }

  function unlock(): Promise<void> {
    if (closed) return Promise.resolve();
    if (unlocking) return unlocking;
    unlocking = (async () => {
      if (!ctx) ctx = factory();
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // leave state as-is; isReady() will report false
        }
      }
    })();
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
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {});
    }
    ctx = null;
    unlocking = null;
  }

  return { unlock, playPhaseStart, playComplete, isReady, close };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm --filter @brewdial/web test -- pour-audio
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/brew-timer/pour-audio.ts apps/web/src/lib/brew-timer/pour-audio.test.ts
git commit -m "feat(brew-timer): add Web Audio cue module for phase/completion"
```

---

### Task 8: Wire timer UI in `+page.svelte`

**Files:**
- Modify: `apps/web/src/routes/recipes/[code]/+page.svelte`

This task is UI integration; it has no isolated unit test, so verification is `pnpm check`, `pnpm build`, plus a manual smoke test in the dev server.

- [ ] **Step 1: Update imports and state**

Replace the current `<script>` import line:
```ts
import { buildPourSchedule, formatSeconds } from '$lib/brew-timer/pour-schedule';
```
with:
```ts
import {
  buildPourSchedule,
  formatSeconds,
  getCurrentPhase,
  getExpectedWaterG,
  getPhaseProgressRatio,
  roundToStep
} from '$lib/brew-timer/pour-schedule';
import { loadSoundPreference, saveSoundPreference } from '$lib/brew-timer/sound-preference';
import { createPourAudio, type PourAudio } from '$lib/brew-timer/pour-audio';
```

Add to the existing `let elapsedSec = $state(0);` block:
```ts
let soundEnabled = $state(true);
let completionAnnounced = $state(false);
let pourAudio: PourAudio | null = null;
```

- [ ] **Step 2: Replace the inline currentPhase derivation with the helper**

Replace:
```ts
const currentPhase = $derived(
  pourSchedule.phases.find((phase) => elapsedSec >= phase.startSec && elapsedSec < phase.endSec) ??
    pourSchedule.phases.at(-1) ??
    null
);
```
with:
```ts
const currentPhase = $derived(
  getCurrentPhase(pourSchedule, elapsedSec) ?? pourSchedule.phases.at(-1) ?? null
);
const expectedWaterG = $derived(getExpectedWaterG(pourSchedule, elapsedSec));
const roundedExpectedG = $derived(
  expectedWaterG === undefined ? undefined : roundToStep(expectedWaterG)
);
const phaseProgressPct = $derived(
  Math.round(getPhaseProgressRatio(pourSchedule, elapsedSec) * 100)
);
```

- [ ] **Step 3: Update startTimer / resetTimer**

Replace `startTimer`:
```ts
function startTimer(): void {
  if (!canUseTimer) return;
  isTimerRunning = true;
  if (pourAudio) {
    void pourAudio.unlock();
  }
  if (currentPhase && lastAnnouncedPhase !== currentPhase.index) {
    lastAnnouncedPhase = currentPhase.index;
    announcePhase(currentPhase);
    if (soundEnabled) pourAudio?.playPhaseStart();
  }
}
```

Replace `resetTimer`:
```ts
function resetTimer(): void {
  isTimerRunning = false;
  elapsedSec = 0;
  lastAnnouncedPhase = -1;
  completionAnnounced = false;
}
```

- [ ] **Step 4: Add toggleSound and testSound handlers**

Add to `<script>`:
```ts
function onSoundToggle(): void {
  saveSoundPreference(soundEnabled);
  if (soundEnabled) void pourAudio?.unlock();
}

function testSound(): void {
  if (!pourAudio) return;
  void pourAudio.unlock().then(() => pourAudio?.playPhaseStart());
}
```

- [ ] **Step 5: Update the 1-second tick in onMount**

Replace the existing `onMount` body with:
```ts
onMount(() => {
  notificationPermission =
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  soundEnabled = loadSoundPreference();
  pourAudio = createPourAudio();

  const id = window.setInterval(() => {
    if (!isTimerRunning) return;
    elapsedSec = Math.min(elapsedSec + 1, pourSchedule.totalSec);
    const phase = pourSchedule.phases.find(
      (candidate) => elapsedSec >= candidate.startSec && elapsedSec < candidate.endSec
    );
    if (phase && phase.index !== lastAnnouncedPhase) {
      lastAnnouncedPhase = phase.index;
      announcePhase(phase);
      if (soundEnabled) pourAudio?.playPhaseStart();
    }
    if (elapsedSec >= pourSchedule.totalSec) {
      isTimerRunning = false;
      if (!completionAnnounced) {
        completionAnnounced = true;
        if (soundEnabled) pourAudio?.playComplete();
      }
    }
  }, 1000);

  return () => {
    window.clearInterval(id);
    pourAudio?.close();
    pourAudio = null;
  };
});
```

- [ ] **Step 6: Add UI markup**

Inside the existing `<section class="card brew-timer">`, just BELOW the `<p class="muted">{currentPhase.note}</p>` line and ABOVE the `nextPhase` block, insert:

```svelte
{#if !timerDone && currentPhase && roundedExpectedG !== undefined}
  <p class="timer-expected">지금쯤 약 <span class="timer-expected-num">{roundedExpectedG}</span>g</p>
  <p class="timer-target muted">목표: {currentPhase.endLabel}까지 {currentPhase.targetWaterG}g</p>
{/if}
{#if !timerDone && currentPhase}
  <div
    class="phase-progress"
    role="progressbar"
    aria-valuenow={phaseProgressPct}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-label="현재 구간 진행률"
  >
    <div class="phase-progress-fill" style="width: {phaseProgressPct}%"></div>
  </div>
{/if}
```

In the existing `<div class="row">` (the buttons), append BEFORE the closing `</div>`:

```svelte
<label class="sound-toggle">
  <input type="checkbox" bind:checked={soundEnabled} onchange={onSoundToggle} />
  사운드
</label>
<button class="btn btn-secondary" type="button" onclick={testSound}>사운드 테스트</button>
```

- [ ] **Step 7: Add CSS at the bottom `<style>` block**

Append inside the existing `<style>` block:

```css
.timer-expected {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: clamp(1.5rem, 6vw, 2.4rem);
  font-weight: 700;
  line-height: 1.1;
  color: var(--accent-strong);
}

.timer-expected-num {
  font-variant-numeric: tabular-nums;
}

.timer-target {
  margin: 0;
  font-size: 0.95rem;
}

.phase-progress {
  width: 100%;
  height: 0.5rem;
  background: var(--surface-muted);
  border-radius: var(--radius);
  overflow: hidden;
}

.phase-progress-fill {
  height: 100%;
  background: var(--accent-strong);
  transition: width 200ms linear;
}

.sound-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95rem;
  color: var(--text-muted);
}
```

- [ ] **Step 8: Run typecheck and tests**

```bash
pnpm check
pnpm test
```
Both must pass.

- [ ] **Step 9: Manual smoke test**

```bash
pnpm --filter @brewdial/web dev
```
Open a recipe at `http://localhost:5173/recipes/<code>` and verify:
- 지금쯤 약 Xg appears, updating in coarse 10g jumps as the timer runs.
- 목표 line shows the correct end time and target.
- Phase progress bar fills smoothly within each phase, snaps back at phase boundaries.
- 사운드 테스트 plays a two-tone beep.
- Untoggling 사운드 silences subsequent phase cues; the preference survives a page reload.
- Reaching the final time plays the completion three-tone cue.

If you cannot test in a browser (headless), say so explicitly in the PR — do not claim success.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/routes/recipes/[code]/+page.svelte
git commit -m "feat(web): live water guide, progress bar, and audio cues for pour timer (ROB-30)"
```

---

### Task 9: Final validation

- [ ] **Run full validation suite**

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
pnpm lint
```

Every command must exit 0. If `pnpm test` reports timer-related vitest failures only when run alongside DOM tests, ensure the test files use `// @vitest-environment jsdom` (or that jsdom is the global vitest environment).

- [ ] **Self-review the diff**

```bash
git log --oneline main..HEAD
git diff main..HEAD -- apps/web/src/lib/brew-timer/ apps/web/src/routes/recipes/[code]/+page.svelte
```
Confirm: no orphan TODOs, no unused imports, no leftover `console.log`, every behavioral requirement listed in the "Behavioral Specification" section is exercised by at least one test.

---

## Checklist (mapping back to the issue)

- [ ] Audible sound cues for phase starts (Task 7 + Task 8 step 5).
- [ ] Audible sound cue for brew completion (Task 7 + Task 8 step 5).
- [ ] Sound on/off control with persistence (Tasks 6 + 8 step 4 + 8 step 6).
- [ ] Test sound button (Task 8 steps 4 + 6).
- [ ] AudioContext unlock on user gesture (Task 7 — `unlock()`; Task 8 — called from `startTimer`, `onSoundToggle`, `testSound`).
- [ ] Live expected water amount via linear interpolation (Tasks 2 + 4 + 8).
- [ ] Display rounded to nearest 10g default (Task 1 + Task 8 step 2/6).
- [ ] Current-phase progress bar (Tasks 5 + 8 step 6/7).
- [ ] Mobile-first, dark-mode readable (Task 8 step 7 — uses existing CSS vars).
- [ ] Existing Notification + vibration cues retained (Task 8 — `announcePhase` is unchanged).
