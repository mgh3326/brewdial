// One-time migration: CouchDB `coffee` -> Supabase (Postgres).
//
// Imports all recipes/feedback/preference and applies the ROB-606/609 audit
// tagging (duplicates -> superseded, discarded draft -> archived, smoke/QA
// records -> test, intended-variant lineage via parent_code). The canonical
// active set is what the app shows; superseded/archived/test are preserved but
// hidden by default (status != 'active').
//
// Dry-run by default (prints a plan, writes nothing). Pass --yes to write.
// Re-runnable: --yes does a clean import (wipes recipes+feedback first).
//
// Reads env from ENV_FILE (default ~/work/brewdial/.env):
//   COUCHDB_URL, COUCHDB_DATABASE, COUCHDB_USERNAME, COUCHDB_PASSWORD
//   VITE_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
//
// Usage (from repo root):
//   node apps/toss/scripts/migrate-couch-to-supabase.mjs          # dry run
//   node apps/toss/scripts/migrate-couch-to-supabase.mjs --yes    # write
//   ENV_FILE=/path/.env node apps/toss/scripts/migrate-couch-to-supabase.mjs

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const WRITE = process.argv.includes('--yes');
const ENV_FILE = process.env.ENV_FILE || join(homedir(), 'work/brewdial/.env');

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv(path) {
  const out = {};
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.error(`Could not read env file: ${path}`);
    process.exit(1);
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = { ...loadEnv(ENV_FILE), ...process.env };
const COUCH_URL = (env.COUCHDB_URL || 'http://127.0.0.1:5984').replace(/\/+$/, '');
const COUCH_DB = env.COUCHDB_DATABASE || 'coffee';
const COUCH_USER = env.COUCHDB_USERNAME || '';
const COUCH_PASS = env.COUCHDB_PASSWORD || '';
const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ── ROB-606/609 audit tagging ────────────────────────────────────────────────
const SUPERSEDED_BY = {
  'COF-0020': 'COF-0021',
  'COF-0031': 'COF-0032',
  'COF-0025': 'COF-0026',
  'COF-0015': 'COF-0040',
  'COF-0008': 'COF-0012',
};
const ARCHIVED = { 'COF-0011': 'COF-0012' }; // discarded draft, replaced by 0012
const TEST = new Set(['COF-0001', 'COF-0006']); // MacBook smoke, ROB-36 QA
const PARENT = { 'COF-0007': 'COF-0004', 'COF-0036': 'COF-0022', 'COF-0049': 'COF-0048' };

function statusFor(code) {
  if (TEST.has(code)) return 'test';
  if (ARCHIVED[code]) return 'archived';
  if (SUPERSEDED_BY[code]) return 'superseded';
  return 'active';
}
const supersededByFor = (code) => SUPERSEDED_BY[code] || ARCHIVED[code] || null;
const parentFor = (code) => PARENT[code] || null;

// ── CouchDB read ─────────────────────────────────────────────────────────────
async function couchAllDocs() {
  const headers = { accept: 'application/json' };
  if (COUCH_USER) {
    headers.authorization = 'Basic ' + Buffer.from(`${COUCH_USER}:${COUCH_PASS}`).toString('base64');
  }
  const res = await fetch(`${COUCH_URL}/${COUCH_DB}/_all_docs?include_docs=true`, { headers });
  if (!res.ok) {
    console.error(`CouchDB read failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const json = await res.json();
  return (json.rows || []).map((r) => r.doc).filter(Boolean);
}

function recipeRow(d) {
  const code = d.code;
  return {
    code,
    method: d.method,
    title: d.title,
    version: typeof d.version === 'number' ? d.version : 1,
    params: d.params ?? {},
    steps: d.steps ?? [],
    bean_id: d.beanId ?? null,
    bean_snapshot: d.beanSnapshot ?? null,
    intent: d.intent ?? null,
    notes: d.notes ?? null,
    adjustment_from_previous: d.adjustmentFromPrevious ?? null,
    created_by: d.createdBy === 'agent' ? 'agent' : 'manual',
    status: statusFor(code),
    supersedes: null,
    superseded_by: supersededByFor(code),
    parent_code: parentFor(code),
    created_at: d.createdAt ?? null,
    updated_at: d.updatedAt ?? d.createdAt ?? null,
  };
}

function feedbackRow(d) {
  return {
    recipe_code: d.recipeCode,
    bean_id: d.beanId ?? null,
    ratings: d.ratings ?? null,
    actual: d.actual ?? null,
    comment: d.comment ?? null,
    raw_comment: d.rawComment ?? null,
    quick_tags: d.quickTags ?? null,
    desired_direction: d.desiredDirection ?? null,
    next_hint: d.nextHint ?? null,
    source: d.source ?? 'web',
    created_at: d.createdAt ?? null,
    updated_at: d.updatedAt ?? d.createdAt ?? null,
  };
}

function codeNum(code) {
  const m = /^COF-(\d+)$/.exec(code || '');
  return m ? Number(m[1]) : 0;
}

async function main() {
  console.log(`Source : ${COUCH_URL}/${COUCH_DB} (auth: ${COUCH_USER ? 'set' : 'none'})`);
  console.log(`Target : ${SUPABASE_URL} (service role)`);
  console.log(`Mode   : ${WRITE ? 'WRITE (clean import)' : 'DRY RUN (no writes)'}\n`);

  const docs = await couchAllDocs();
  const recipes = docs.filter((d) => d.type === 'recipe' && d.code);
  const feedback = docs.filter((d) => d.type === 'feedback' && d.recipeCode);
  const preference = docs.find((d) => d.type === 'preference');

  const recipeRows = recipes.map(recipeRow);
  const codes = new Set(recipeRows.map((r) => r.code));
  const feedbackRows = [];
  const orphanFeedback = [];
  for (const d of feedback) {
    if (codes.has(d.recipeCode)) feedbackRows.push(feedbackRow(d));
    else orphanFeedback.push(d.recipeCode);
  }

  const byStatus = recipeRows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {});
  const maxCode = Math.max(0, ...recipeRows.map((r) => codeNum(r.code)));

  console.log(`Recipes : ${recipeRows.length}  ${JSON.stringify(byStatus)}`);
  console.log(`Feedback: ${feedbackRows.length}${orphanFeedback.length ? ` (skipping ${orphanFeedback.length} orphan: ${[...new Set(orphanFeedback)].join(', ')})` : ''}`);
  console.log(`Preference: ${preference ? 'yes' : 'none'}`);
  console.log(`Max code: COF-${String(maxCode).padStart(4, '0')} -> sequence will be set to ${maxCode}\n`);

  const tagged = recipeRows
    .filter((r) => r.status !== 'active')
    .map((r) => `  ${r.code}: ${r.status}${r.superseded_by ? ` -> ${r.superseded_by}` : ''}`);
  const lineage = recipeRows.filter((r) => r.parent_code).map((r) => `  ${r.code}: parent ${r.parent_code}`);
  if (tagged.length) console.log('Tagged (non-active):\n' + tagged.join('\n'));
  if (lineage.length) console.log('Lineage (intended variants):\n' + lineage.join('\n'));

  if (!WRITE) {
    console.log('\nDRY RUN complete. Re-run with --yes to write.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  console.log('\nClean import: deleting existing feedback + recipes...');
  let del = await supabase.from('feedback').delete().not('id', 'is', null);
  if (del.error) throw new Error('delete feedback: ' + del.error.message);
  del = await supabase.from('recipes').delete().not('id', 'is', null);
  if (del.error) throw new Error('delete recipes: ' + del.error.message);

  console.log(`Inserting ${recipeRows.length} recipes...`);
  let ins = await supabase.from('recipes').insert(recipeRows);
  if (ins.error) throw new Error('insert recipes: ' + ins.error.message);

  console.log(`Inserting ${feedbackRows.length} feedback...`);
  ins = await supabase.from('feedback').insert(feedbackRows);
  if (ins.error) throw new Error('insert feedback: ' + ins.error.message);

  if (preference) {
    const pref = {
      id: 'global',
      likes: preference.likes ?? [],
      dislikes: preference.dislikes ?? [],
      default_params: preference.defaultParams ?? {},
    };
    const up = await supabase.from('preferences').upsert(pref, { onConflict: 'id' });
    if (up.error) throw new Error('upsert preference: ' + up.error.message);
  }

  console.log(`Advancing recipe_code_seq to ${maxCode}...`);
  const seq = await supabase.rpc('set_recipe_code_seq', { n: maxCode });
  if (seq.error) {
    console.warn('  rpc set_recipe_code_seq failed: ' + seq.error.message);
    console.warn(`  → run once in Supabase SQL editor: select setval('recipe_code_seq', ${maxCode}, true);`);
  }

  console.log('\n✅ Migration complete.');
}

main().catch((e) => {
  console.error('\n❌ Migration failed:', e.message);
  process.exit(1);
});
