import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  expectedRecommend,
  expectedValidation,
  type RecommendCase,
  type ValidationCase
} from './parity-golden.js';

// The same fixtures drive apps/api-kt ParityGoldenTest, so a change here that is
// not mirrored in Kotlin fails CI. Regenerate with `pnpm --filter @brewdial/shared parity:update`.
const dir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/parity');
const load = <T>(file: string): T[] =>
  (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { cases: T[] }).cases;

describe('recommend parity golden', () => {
  for (const c of load<RecommendCase>('recommend.json')) {
    it(c.name, () => expect(expectedRecommend(c)).toEqual(c.expected));
  }
});

describe('validation parity golden', () => {
  for (const c of load<ValidationCase>('validation.json')) {
    it(c.name, () => expect(expectedValidation(c)).toEqual(c.expected));
  }
});
