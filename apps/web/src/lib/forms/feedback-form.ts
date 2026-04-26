import type { CreateFeedbackInput, FeedbackRatings } from '@brewdial/shared';

export interface FeedbackFormValues {
  recipeCode?: string;
  overall?: string;
  sweetness?: string;
  burnt?: string;
  bitter?: string;
  sour?: string;
  body?: string;
  astringency?: string;
  clarity?: string;
  comment?: string;
  desiredDirectionText?: string;
  tempC?: string;
  grind?: string;
  timeSec?: string;
}

const RATING_KEYS: ReadonlyArray<keyof FeedbackRatings> = [
  'overall',
  'sweetness',
  'burnt',
  'bitter',
  'sour',
  'body',
  'astringency',
  'clarity'
];

const STRING_KEYS: ReadonlyArray<keyof FeedbackFormValues> = [
  'recipeCode',
  'overall',
  'sweetness',
  'burnt',
  'bitter',
  'sour',
  'body',
  'astringency',
  'clarity',
  'comment',
  'tempC',
  'grind',
  'timeSec'
];

const RAW_TEXT_KEYS: ReadonlyArray<keyof FeedbackFormValues> = ['desiredDirectionText'];

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

export function formDataToFeedbackValues(formData: FormData): FeedbackFormValues {
  const out: FeedbackFormValues = {};
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

function parseInt10(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : undefined;
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

export function feedbackValuesToInput(values: FeedbackFormValues): CreateFeedbackInput {
  const ratings: FeedbackRatings = {};
  for (const key of RATING_KEYS) {
    const parsed = parseInt10(values[key as keyof FeedbackFormValues]);
    if (parsed !== undefined) (ratings as Record<string, number>)[key] = parsed;
  }

  const input: CreateFeedbackInput = {
    recipeCode: (values.recipeCode ?? '') as CreateFeedbackInput['recipeCode'],
    ratings
  };

  if (values.comment) input.comment = values.comment;

  const desiredDirection = linesToArray(values.desiredDirectionText);
  if (desiredDirection.length > 0) input.desiredDirection = desiredDirection;

  const actual: NonNullable<CreateFeedbackInput['actual']> = {};
  const tempC = parseNumber(values.tempC);
  const timeSec = parseNumber(values.timeSec);
  if (tempC !== undefined) actual.tempC = tempC;
  if (timeSec !== undefined) actual.timeSec = timeSec;
  if (values.grind) actual.grind = values.grind;
  if (Object.keys(actual).length > 0) input.actual = actual;

  return input;
}
