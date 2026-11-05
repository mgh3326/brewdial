#!/usr/bin/env node
// Copy the domain core from packages/shared/src into apps/miniapp/src/lib/domain.
//
// The Apps-in-Toss `ait` packaging step cannot resolve workspace-symlinked
// packages, so the mini-app keeps its own copy of these files. The copy is
// generated, not edited: change packages/shared and run this script.
//
//   node scripts/sync-miniapp-domain.mjs          # rewrite the copies
//   node scripts/sync-miniapp-domain.mjs --check  # fail if a copy is stale (CI)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'packages/shared/src');
const targetDir = join(root, 'apps/miniapp/src/lib/domain');

// Order does not matter; index.ts in the target is hand-written and re-exports these.
export const FILES = [
  'api-types.ts',
  'dripper.ts',
  'feedback-rules.ts',
  'grinder.ts',
  'schemas.ts',
  'types.ts',
  'validation.ts'
];

function header(file) {
  return (
    `// GENERATED from packages/shared/src/${file} by scripts/sync-miniapp-domain.mjs.\n` +
    `// Do not edit: change packages/shared and run \`pnpm domain:sync\`.\n`
  );
}

const check = process.argv.includes('--check');
const stale = [];

for (const file of FILES) {
  const expected = header(file) + readFileSync(join(sourceDir, file), 'utf8');
  const target = join(targetDir, file);
  const actual = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (actual === expected) continue;
  if (check) stale.push(file);
  else {
    writeFileSync(target, expected);
    console.log(`synced ${file}`);
  }
}

if (stale.length > 0) {
  console.error(
    `apps/miniapp/src/lib/domain is out of sync with packages/shared: ${stale.join(', ')}\n` +
      'Run `pnpm domain:sync` and commit the result.'
  );
  process.exit(1);
}
