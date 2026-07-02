import type { CreateRecipeInput, RecipeDoc, RecipeParams, RecipeStep } from './domain';

// ROB-634 — deterministic dose rescaler. Scaling doseG, params.waterG, and every
// step.waterG by the same factor k preserves all of validateCreateRecipeInput's
// cross-field invariants (ratio, cumulative-reaches-total). atSec/tempC/grind
// are preserved verbatim.
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function scaleRecipe(recipe: RecipeDoc, newDose: number): CreateRecipeInput {
  const oldDose = recipe.params.doseG;
  if (oldDose === undefined || oldDose <= 0 || !Number.isFinite(oldDose)) {
    throw new Error('scaleRecipe: source recipe params.doseG must be a positive finite number');
  }
  if (!Number.isFinite(newDose) || newDose <= 0) {
    throw new Error('scaleRecipe: newDose must be a positive finite number');
  }
  const k = newDose / oldDose;

  const oldParams = recipe.params;
  const newParams: RecipeParams = { doseG: newDose };
  if (oldParams.waterG !== undefined) newParams.waterG = round1(oldParams.waterG * k);
  if (oldParams.ratio !== undefined) newParams.ratio = oldParams.ratio;
  if (oldParams.tempC !== undefined) newParams.tempC = oldParams.tempC;
  if (oldParams.grind !== undefined) newParams.grind = oldParams.grind;
  if (oldParams.grinder !== undefined) newParams.grinder = oldParams.grinder;
  if (oldParams.brewer !== undefined) newParams.brewer = oldParams.brewer;
  if (oldParams.targetTimeSec !== undefined) newParams.targetTimeSec = oldParams.targetTimeSec;

  const newSteps: RecipeStep[] = recipe.steps.map((s) => {
    const out: RecipeStep = { note: s.note };
    if (s.waterG !== undefined) out.waterG = round1(s.waterG * k);
    if (s.atSec !== undefined) out.atSec = s.atSec;
    if (s.endSec !== undefined) out.endSec = s.endSec;
    if (s.pourRateGPerSec !== undefined) out.pourRateGPerSec = s.pourRateGPerSec;
    return out;
  });

  const input: CreateRecipeInput = {
    method: recipe.method,
    title: `${recipe.title} · ${newDose}g`,
    params: newParams,
    steps: newSteps,
  };
  if (recipe.beanId !== undefined) input.beanId = recipe.beanId;
  if (recipe.beanSnapshot !== undefined) input.beanSnapshot = recipe.beanSnapshot;
  if (recipe.intent !== undefined) input.intent = recipe.intent;
  input.adjustmentFromPrevious = `${oldDose}g → ${newDose}g 용량 스케일`;
  if (recipe.dripperPortability !== undefined) input.dripperPortability = recipe.dripperPortability;
  return input;
}
