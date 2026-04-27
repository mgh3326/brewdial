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
