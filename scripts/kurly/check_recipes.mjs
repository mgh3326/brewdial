import fs from 'node:fs';
import { validateCreateRecipeInput } from '../../packages/shared/dist/validation.js';

const manifestPath = '/Users/mgh3326/work/herdr-inbox/jobs/rob1291-p2-manifest-20260819-1703/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let drafts = 0;
let invalid = 0;
let snapshotMismatch = 0;

for (const entry of manifest.entries) {
  if (!entry.recipe_draft) continue;
  drafts += 1;
  const result = validateCreateRecipeInput(entry.recipe_draft);
  if (!result.ok) {
    invalid += 1;
    console.log(`invalid: ${entry.bean?.name ?? entry.bean_key}: ${JSON.stringify(result.errors)}`);
  }
  const snapshot = entry.recipe_draft.beanSnapshot;
  if (!entry.bean || snapshot?.name !== entry.bean.name || snapshot?.roaster !== entry.bean.roaster) {
    snapshotMismatch += 1;
    console.log(`snapshot_mismatch: ${entry.bean?.name ?? entry.bean_key}`);
  }
}

console.log(`drafts: ${drafts}, invalid: ${invalid}, snapshot_mismatch: ${snapshotMismatch}`);
process.exitCode = invalid || snapshotMismatch ? 1 : 0;
