// Ported from apps/web/src/lib/brew-timer/pour-schedule.ts (import retargeted to vendored domain).
import type { RecipeDoc, RecipeStep } from '../domain';

export interface PourPhase {
  index: number;
  startSec: number;
  endSec: number;
  startLabel: string;
  endLabel: string;
  targetWaterG?: number;
  note: string;
}

export interface PourSchedule {
  totalSec: number;
  phases: PourPhase[];
}

export function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

type TimedRecipeStep = RecipeStep & { atSec: number; originalIndex: number };

function hasAtSec(step: RecipeStep & { originalIndex: number }): step is TimedRecipeStep {
  return typeof step.atSec === 'number' && Number.isFinite(step.atSec) && step.atSec >= 0;
}

export function buildPourSchedule(recipe: RecipeDoc): PourSchedule {
  const timedSteps = recipe.steps
    .map((step, originalIndex) => ({ ...step, originalIndex }))
    .filter(hasAtSec)
    .sort((a, b) => a.atSec - b.atSec);

  const lastStep = timedSteps.at(-1);
  const lastStepSec = Math.max(lastStep?.atSec ?? 0, lastStep?.endSec ?? 0);
  const rawTarget = recipe.params.targetTimeSec;
  const totalSec =
    typeof rawTarget === 'number' && Number.isFinite(rawTarget) && rawTarget > lastStepSec
      ? Math.floor(rawTarget)
      : Math.floor(lastStepSec);

  const phases = timedSteps.map((step, index): PourPhase => {
    const startSec = Math.floor(step.atSec);
    const nextStart = timedSteps[index + 1]?.atSec;
    const endSec = Math.floor(nextStart !== undefined ? nextStart : totalSec);
    return {
      index,
      startSec,
      endSec,
      startLabel: formatSeconds(startSec),
      endLabel: formatSeconds(endSec),
      targetWaterG: step.waterG,
      note: step.note
    };
  });

  return { totalSec, phases };
}

export function roundToStep(grams: number, stepG = 10): number {
  if (!Number.isFinite(grams) || grams < 0) return 0;
  const step = Number.isFinite(stepG) && stepG > 0 ? stepG : 1;
  return Math.round(grams / step) * step;
}

export function getPhaseStartWaterG(schedule: PourSchedule, phaseIndex: number): number {
  if (phaseIndex <= 0 || phaseIndex >= schedule.phases.length) return 0;
  for (let i = phaseIndex - 1; i >= 0; i--) {
    const w = schedule.phases[i].targetWaterG;
    if (typeof w === 'number' && Number.isFinite(w)) return w;
  }
  return 0;
}

export function getCurrentPhase(schedule: PourSchedule, elapsedSec: number): PourPhase | null {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return null;
  if (elapsedSec >= schedule.totalSec) return null;
  return (
    schedule.phases.find(
      (phase) => elapsedSec >= phase.startSec && elapsedSec < phase.endSec
    ) ?? null
  );
}

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

export function getPhaseProgressRatio(schedule: PourSchedule, elapsedSec: number): number {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return 0;
  const phase = getCurrentPhase(schedule, elapsedSec);
  if (!phase) return elapsedSec <= 0 ? 0 : 1;
  const span = phase.endSec - phase.startSec;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (elapsedSec - phase.startSec) / span));
}

export function phaseRateGPerSec(
  step: RecipeStep,
  startWaterG: number,
  endSec: number
): number | undefined {
  if (
    typeof step.pourRateGPerSec === 'number' &&
    Number.isFinite(step.pourRateGPerSec) &&
    step.pourRateGPerSec > 0
  ) {
    return step.pourRateGPerSec;
  }
  if (
    typeof step.atSec !== 'number' ||
    typeof step.waterG !== 'number' ||
    typeof step.endSec !== 'number' ||
    typeof endSec !== 'number'
  ) {
    return undefined;
  }
  const span = endSec - step.atSec;
  const delta = step.waterG - startWaterG;
  if (!(span > 0) || !(delta > 0)) return undefined;
  return delta / span;
}

export type BrewPhaseKind = 'bloom' | 'pour';

export interface BrewPhase {
  index: number;
  kind: BrewPhaseKind;
  startSec: number;
  pourEndSec: number;
  endSec: number;
  startLabel: string;
  pourEndLabel: string;
  endLabel: string;
  startWaterG: number;
  targetWaterG?: number;
  pourRateGPerSec?: number;
  note?: string;
}

export function buildBrewPhases(recipe: RecipeDoc): BrewPhase[] {
  const timedSteps = recipe.steps
    .map((step, originalIndex) => ({ ...step, originalIndex }))
    .filter(hasAtSec)
    .sort((a, b) => a.atSec - b.atSec);

  if (timedSteps.length === 0) return [];

  const lastStepSec = Math.max(
    timedSteps.at(-1)?.atSec ?? 0,
    timedSteps.at(-1)?.endSec ?? 0
  );
  const rawTarget = recipe.params.targetTimeSec;
  const totalSec =
    typeof rawTarget === 'number' && Number.isFinite(rawTarget) && rawTarget > lastStepSec
      ? Math.floor(rawTarget)
      : Math.floor(lastStepSec);

  let cumulativeStart = 0;

  return timedSteps.map((step, j): BrewPhase => {
    const startSec = Math.floor(step.atSec);
    const endSec = Math.floor(timedSteps[j + 1]?.atSec ?? totalSec);
    const pourEndSec =
      typeof step.endSec === 'number' &&
      Number.isFinite(step.endSec) &&
      step.endSec > step.atSec &&
      step.endSec <= endSec
        ? Math.floor(step.endSec)
        : endSec;

    const startWaterG = cumulativeStart;
    const pourRate = phaseRateGPerSec(step, startWaterG, pourEndSec);

    const phase: BrewPhase = {
      index: j,
      kind: j === 0 ? 'bloom' : 'pour',
      startSec,
      pourEndSec,
      endSec,
      startLabel: formatSeconds(startSec),
      pourEndLabel: formatSeconds(pourEndSec),
      endLabel: formatSeconds(endSec),
      startWaterG,
      targetWaterG: step.waterG,
      pourRateGPerSec: pourRate,
      note: step.note
    };

    if (typeof step.waterG === 'number' && Number.isFinite(step.waterG)) {
      cumulativeStart = step.waterG;
    }
    return phase;
  });
}

export function getCurrentBrewPhase(phases: BrewPhase[], elapsedSec: number): BrewPhase | null {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return null;
  const last = phases.at(-1);
  if (!last) return null;
  if (elapsedSec >= last.endSec) return null;
  return phases.find((p) => elapsedSec >= p.startSec && elapsedSec < p.endSec) ?? null;
}

export function isBrewPhaseResting(phase: BrewPhase, elapsedSec: number): boolean {
  return phase.pourEndSec < phase.endSec && elapsedSec >= phase.pourEndSec && elapsedSec < phase.endSec;
}

export function getExpectedWaterGForPhase(
  phase: BrewPhase,
  elapsedSec: number
): number | undefined {
  if (phase.targetWaterG === undefined) return undefined;
  if (elapsedSec >= phase.pourEndSec) return phase.targetWaterG;
  const span = phase.pourEndSec - phase.startSec;
  if (span <= 0) return phase.targetWaterG;
  const ratio = Math.max(0, Math.min(1, (elapsedSec - phase.startSec) / span));
  return phase.startWaterG + ratio * (phase.targetWaterG - phase.startWaterG);
}

export function getBrewPhaseProgressRatio(phase: BrewPhase, elapsedSec: number): number {
  if (!Number.isFinite(elapsedSec) || elapsedSec <= phase.startSec) return 0;
  if (elapsedSec >= phase.endSec) return 1;
  const span = phase.endSec - phase.startSec;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (elapsedSec - phase.startSec) / span));
}
