// Computes the `expected` values of the TS↔Kotlin parity fixtures in
// src/__fixtures__/parity. Not exported from index.ts: it exists for
// parity-golden.test.ts and scripts/update-parity-golden.mjs only.
import { deriveTasteTarget, scoreBean, type TasteSignals } from './recommend.js';
import type { BeanAttributes } from './types.js';
import {
  validateCreateBeanPurchaseLinkInput,
  validateCreateRecipeInput,
  validateUpdateBeanAttributesInput,
  validateUpdatePreferencesInput,
  type ValidationResult
} from './validation.js';

export interface RecommendCase {
  name: string;
  signals: TasteSignals;
  beans: BeanAttributes[];
  expected?: unknown;
}

export interface ValidationCase {
  name: string;
  validator: keyof typeof VALIDATORS;
  input: unknown;
  expected?: unknown;
}

// Validators that both packages/shared and apps/api-kt implement.
export const VALIDATORS = {
  CreateRecipe: validateCreateRecipeInput,
  UpdateBeanAttributes: validateUpdateBeanAttributesInput,
  CreateBeanPurchaseLink: validateCreateBeanPurchaseLinkInput,
  UpdatePreferences: validateUpdatePreferencesInput
} satisfies Record<string, (input: unknown) => ValidationResult<unknown>>;

// JSON round-trip so the value equals what the fixture file stores (undefined dropped).
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

export function expectedRecommend(c: RecommendCase): unknown {
  const target = deriveTasteTarget(c.signals);
  return asJson({ target, scores: c.beans.map((bean) => scoreBean(bean, target)) });
}

export function expectedValidation(c: ValidationCase): unknown {
  const validate = VALIDATORS[c.validator];
  if (!validate) throw new Error(`${c.name}: unknown validator ${String(c.validator)}`);
  return asJson(validate(c.input));
}
