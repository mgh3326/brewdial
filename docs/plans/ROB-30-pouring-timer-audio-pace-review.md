# ROB-30 Review Report — BrewDial Pouring Timer: Audible Alerts and Live Target Water Guide

**Reviewer:** Opus planner/reviewer
**Branch:** `feature/ROB-30-brewdial-pouring-timer-audio-pace`
**Plan commit:** `7e62795 docs: add ROB-30 implementation plan`
**Implementation commit:** `7a15681 feat: add pouring timer audio pace guide (ROB-30)`
**Verdict:** **PASS** — ready for PR.

---

## Validation results (run from worktree)

| Command | Result |
| --- | --- |
| `pnpm --filter @brewdial/web test` | **104/104 passing** (11 test files; 32 brew-timer tests across `pour-schedule`, `pour-audio`, `sound-preference`) |
| `pnpm --filter @brewdial/web check` | **0 errors, 0 warnings** (svelte-check across 416 files) |
| `pnpm --filter @brewdial/web build` | **OK** (recipe `[code]` page bundle: 14.61 kB / 3.58 kB gz, no SSR errors) |

`pnpm lint` is a documented no-op for `@brewdial/web` (`echo '@brewdial/web: no lint in PR1 (intentional no-op)' && exit 0`), so it remains green.

---

## Spec coverage matrix

| Issue requirement | Plan task | Implementation | Verified by |
| --- | --- | --- | --- |
| Audible cue at phase starts | T7 + T8 | `pour-audio.ts` `playPhaseStart` (two 880 Hz tones) wired in `+page.svelte` `onMount` tick (line 140) and in `startTimer` (line 100) | `pour-audio.test.ts:89` ("schedules two 880Hz oscillators") |
| Audible cue at brew completion | T7 + T8 | `playComplete` (988→784→523 Hz arpeggio) fires once on `elapsedSec >= totalSec`, gated by `completionAnnounced` (line 144–147) | `pour-audio.test.ts:101` ("three descending oscillators") |
| Live expected water by linear interpolation | T2 + T4 + T8 | `getExpectedWaterG` → `start + ratio·(target − start)` where `start` is `getPhaseStartWaterG` (`pour-schedule.ts:87–100`) | `pour-schedule.test.ts:159–190`; spot-checks: 22.5 s → 40 g, 75 s → 155 g |
| Round display to nearest 10 g (default) | T1 + T8 | `roundToStep(grams, stepG = 10)` in `pour-schedule.ts:62–66`; `+page.svelte:38` derives `roundedExpectedG` | `pour-schedule.test.ts:77–98` |
| Current-phase progress bar | T5 + T8 | `getPhaseProgressRatio` (`pour-schedule.ts:102–109`); UI `<div role="progressbar" aria-valuenow=…>` (`+page.svelte:235–244`) with CSS in same file | `pour-schedule.test.ts:192–210`; visual contract via `aria-valuenow` and width style |
| Sound on/off control | T6 + T8 | `<input type="checkbox" bind:checked={soundEnabled} onchange={onSoundToggle}>` (`+page.svelte:264–267`) | code-only (no UI snapshot test, acceptable) |
| Sound preference persisted across sessions | T6 + T8 | `loadSoundPreference()`/`saveSoundPreference()` over `localStorage` key `brewdial.timer.soundEnabled` (`sound-preference.ts`) | `sound-preference.test.ts` (5 tests; defaults, parse, persist, throw resilience) |
| Test sound button | T8 | `사운드 테스트` button calls `unlock().then(playPhaseStart)` (`+page.svelte:120–123, 268`) | code review |
| Web Audio unlock on user gesture | T7 + T8 | `unlock()` is the only path that constructs the `AudioContext`; called from `startTimer`, `onSoundToggle`, `testSound`, never on mount | `pour-audio.test.ts:69` ("does not construct an AudioContext until unlock") |
| Existing Notification + vibration cues retained | T8 | `announcePhase()` is called unchanged on every phase transition (line 139), in addition to the new audio cue | code review |
| Mobile-first / dark-mode-readable styling | T8 step 7 | All new CSS uses existing tokens (`--accent-strong`, `--surface-muted`, `--radius`, `--text-muted`) and `clamp()` for fluid sizing (`+page.svelte:367–405`) | code review |

Final-phase end at `params.targetTimeSec`: confirmed unchanged in `buildPourSchedule` (last phase's `endSec = totalSec` when no further step exists), exercised by `buildPourSchedule.test.ts`.

---

## Helper-by-helper deep check

- **`getCurrentPhase(schedule, elapsedSec)`** — half-open ranges (`startSec ≤ t < endSec`); returns `null` at or past `totalSec`, on negative elapsed, or empty schedules. Boundary tests at 44/45/104/105/219/220 confirm correctness.
- **`getPhaseStartWaterG(schedule, i)`** — returns 0 for index 0, scans backward for the most recent prior phase with a finite `targetWaterG`, 0 fallback. Matches the issue example (phase 1 starts at 80 g, phase 2 at 230 g, …), and the sparse-target test confirms the backward-scan branch.
- **`getExpectedWaterG`** — multiplies `clamp((elapsed − start) / span, 0, 1)` by `(target − start)` and adds `start`. Returns `undefined` past `totalSec` and when the current phase has no `targetWaterG`. The 22.5 s → 40 g and 75 s → 155 g cases match the issue description verbatim.
- **`roundToStep`** — guards against negative/NaN inputs and non-positive `stepG`. Tests document the deliberate `155 → 160` outcome (JS `Math.round` rounds .5 toward +∞).
- **`getPhaseProgressRatio`** — clamps to `[0, 1]`; returns 1 once the brew is finished so the bar visually completes; 0 for negatives.

All five helpers are pure, framework-free, and dependency-free aside from existing `RecipeDoc` typings.

---

## UI integration deep check (`apps/web/src/routes/recipes/[code]/+page.svelte`)

- The `currentPhase` derivation now delegates to `getCurrentPhase` and falls back to the last phase for the post-brew display — the previous behavior is preserved.
- Live water markup (lines 230–233) gates on `!timerDone && currentPhase && roundedExpectedG !== undefined`, which is exactly the right tri-condition for the "지금쯤 약 Xg" wording.
- Target line uses `currentPhase.endLabel` + `currentPhase.targetWaterG` (e.g. "목표: 0:45까지 80g"), matching the issue verbiage.
- Progress bar exposes `role="progressbar"`, `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-label="현재 구간 진행률"`, satisfying accessibility expectations.
- Audio plumbing:
  - `pourAudio` is constructed once in `onMount` (client only, SSR-safe).
  - `unlock()` is invoked on every user-gesture path (Start brew, sound toggle ON, sound test button).
  - Phase-start cue fires only when `phase.index !== lastAnnouncedPhase`, so pause/resume across a boundary does not duplicate the cue.
  - Completion cue is gated by `completionAnnounced`, which is reset by `resetTimer`. Multiple ticks past `totalSec` cannot replay it.
  - The interval cleanup also closes the audio context (`pourAudio?.close(); pourAudio = null;`).
- Existing Notification + vibration paths in `announcePhase` are unchanged — secondary cues are preserved.

---

## Test quality

- **`pour-schedule.test.ts`**: 21 tests (8 pre-existing + 13 new) covering each helper's happy path, edge cases (out-of-range index, sparse targets, missing target on later phases, span ≤ 0, negatives), and the full 5-phase schedule from the issue.
- **`sound-preference.test.ts`**: 5 tests including default, parse-strictness ("garbage" → true, "false" → false), persistence, `setItem` throw resilience, and `getItem` throw resilience. Uses `// @vitest-environment jsdom`.
- **`pour-audio.test.ts`**: 6 tests using a fake `AudioContext` factory; covers lazy construction, idempotent unlock, frequency-correct phase-start (2 × 880 Hz) and complete (988/784/523 Hz) cues, no-op-before-unlock, and idempotent close.

No flake or timing-dependent assertions observed. Tests do not rely on real timers or real Web Audio.

---

## Scope and hygiene

- Only the in-scope files are touched (helpers + tests + `+page.svelte`). No edits under `apps/mcp`, `packages/shared`, infra, or any prod path.
- One out-of-scope-but-justified change: `apps/web/package.json` and `pnpm-lock.yaml` add `jsdom@^29.1.0` as a dev dependency, required so `sound-preference.test.ts` can use `localStorage`. This is a test-only addition, properly recorded in `devDependencies`.
- No secrets, env edits, deploy scripts, PWA/service-worker code, brew-log persistence, manual water entry, Bluetooth scale code, or audio file assets — all stated non-goals respected.
- No leftover `console.log`, no TODO comments, no dead code.

---

## Minor observations (non-blocking, no fixes required)

1. At the exact phase boundary (e.g. `elapsedSec === 45`) the UI briefly shows `지금쯤 약 80g` for the new phase (because the new phase's interpolation starts at the previous cumulative). This matches the spec ("phase start water is the previous cumulative target") and is desirable.
2. `pour-audio.test.ts` does not declare `@vitest-environment` and therefore inherits the project default. Because every test injects a fake factory, no DOM is touched and all 6 tests pass under the default environment. Fine as-is.
3. Once a brew completes and the user clicks `Start brew` again without pressing `Reset`, the timer immediately re-finishes silently (`completionAnnounced` is still true). This is reasonable: the safe primitive is `Reset → Start brew`. Not worth additional UX work in this issue.
4. `roundToStep(155)` returns 160 (documented and tested). Acceptable for a "지금쯤 약" approximation.

---

## Conclusion

The implementation faithfully realizes the plan and the ROB-30 spec. Helpers are correct and well-tested, UI wording matches the issue ("지금쯤 약 …g", "목표: <end>까지 <target>g"), audio cues respect browser autoplay policy by routing through `unlock()` on user gestures, and existing Notification/vibration cues are preserved. All validation commands pass.

**Recommendation: pass review and proceed to PR.**
