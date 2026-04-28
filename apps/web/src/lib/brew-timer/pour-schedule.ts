import type { RecipeDoc, RecipeStep } from '@brewdial/shared';

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

  const lastStepSec = timedSteps.at(-1)?.atSec ?? 0;
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
