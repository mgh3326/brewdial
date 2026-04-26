import type { CreateRecipeInput } from '@brewdial/shared';

export interface RecipeFormValues {
  title?: string;
  method?: string;
  beanName?: string;
  roaster?: string;
  roastDate?: string;
  doseG?: string;
  waterG?: string;
  tempC?: string;
  grind?: string;
  targetTimeSec?: string;
  intentText?: string;
  stepsText?: string;
}

const STRING_KEYS: ReadonlyArray<keyof RecipeFormValues> = [
  'title',
  'method',
  'beanName',
  'roaster',
  'roastDate',
  'doseG',
  'waterG',
  'tempC',
  'grind',
  'targetTimeSec'
];

const RAW_TEXT_KEYS: ReadonlyArray<keyof RecipeFormValues> = ['intentText', 'stepsText'];

function readTrimmed(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readRaw(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  return raw.trim().length === 0 ? undefined : raw;
}

export function formDataToRecipeValues(formData: FormData): RecipeFormValues {
  const out: RecipeFormValues = {};
  for (const key of STRING_KEYS) {
    const v = readTrimmed(formData, key);
    if (v !== undefined) (out as Record<string, string>)[key] = v;
  }
  for (const key of RAW_TEXT_KEYS) {
    const v = readRaw(formData, key);
    if (v !== undefined) (out as Record<string, string>)[key] = v;
  }
  return out;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function linesToArray(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function recipeValuesToInput(values: RecipeFormValues): CreateRecipeInput {
  const input: CreateRecipeInput = {
    method: (values.method ?? '') as CreateRecipeInput['method'],
    title: values.title ?? ''
  };

  const beanSnapshot: NonNullable<CreateRecipeInput['beanSnapshot']> = {};
  if (values.beanName) beanSnapshot.name = values.beanName;
  if (values.roaster) beanSnapshot.roaster = values.roaster;
  if (values.roastDate) beanSnapshot.roastDate = values.roastDate;
  if (Object.keys(beanSnapshot).length > 0) input.beanSnapshot = beanSnapshot;

  const params: NonNullable<CreateRecipeInput['params']> = {};
  const doseG = parseNumber(values.doseG);
  const waterG = parseNumber(values.waterG);
  const tempC = parseNumber(values.tempC);
  const targetTimeSec = parseNumber(values.targetTimeSec);
  if (doseG !== undefined) params.doseG = doseG;
  if (waterG !== undefined) params.waterG = waterG;
  if (tempC !== undefined) params.tempC = tempC;
  if (targetTimeSec !== undefined) params.targetTimeSec = targetTimeSec;
  if (values.grind) params.grind = values.grind;
  if (Object.keys(params).length > 0) input.params = params;

  const intent = linesToArray(values.intentText);
  if (intent.length > 0) input.intent = intent;

  const stepNotes = linesToArray(values.stepsText);
  if (stepNotes.length > 0) input.steps = stepNotes.map((note) => ({ note }));

  return input;
}
