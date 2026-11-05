#!/usr/bin/env node
// Rewrite the `expected` of every case in src/__fixtures__/parity from the
// TypeScript implementation (dist/). Run after an intentional behavior change,
// then make apps/api-kt match (ParityGoldenTest).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedRecommend, expectedValidation } from '../dist/parity-golden.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/__fixtures__/parity');

for (const [file, compute] of [
  ['recommend.json', expectedRecommend],
  ['validation.json', expectedValidation]
]) {
  const path = join(dir, file);
  const fixture = JSON.parse(readFileSync(path, 'utf8'));
  fixture.cases = fixture.cases.map(({ expected: _old, ...c }) => ({ ...c, expected: compute(c) }));
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`updated ${file} (${fixture.cases.length} cases)`);
}
