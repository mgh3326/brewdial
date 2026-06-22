import type {
  BeanSnapshot,
  CreateRecipeInput,
  RecipeCode,
  RecipeDoc,
  RecipeParams,
  RecipeStatus,
  RecipeStep,
} from '@brewdial/shared';
import type { SupabaseConfig } from '../config.js';
import { insertRow, selectRows, updateRows } from '../supabase.js';
import { RECIPE_COLUMNS, recipeToInsertRow, rowToRecipe, type RecipeRow } from '../mappers.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function eqCode(code: string): string {
  return `code=eq.${encodeURIComponent(code)}`;
}

export async function createRecipe(
  config: SupabaseConfig,
  input: CreateRecipeInput,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc> {
  // code is assigned by the Postgres sequence (recipe_code_seq) on insert.
  const row = await insertRow<RecipeRow>(
    config,
    'recipes',
    recipeToInsertRow(input),
    RECIPE_COLUMNS,
    fetchImpl
  );
  return rowToRecipe(row);
}

export async function getRecipeByCode(
  config: SupabaseConfig,
  code: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc | null> {
  // MCP is agent-facing: return a recipe of ANY status (so the agent can read,
  // edit, archive, or supersede it). The mini-app applies its own status filter.
  const rows = await selectRows<RecipeRow>(
    config,
    'recipes',
    `${eqCode(code)}&select=${RECIPE_COLUMNS}&limit=1`,
    fetchImpl
  );
  return rows[0] ? rowToRecipe(rows[0]) : null;
}

export async function listRecentRecipes(
  config: SupabaseConfig,
  limit: number = DEFAULT_LIMIT,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const safe = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const rows = await selectRows<RecipeRow>(
    config,
    'recipes',
    `status=eq.active&select=${RECIPE_COLUMNS}&order=created_at.desc&limit=${safe}`,
    fetchImpl
  );
  return rows.map(rowToRecipe);
}

// ── ROB-605: edit ────────────────────────────────────────────────────────────
export interface RecipeUpdate {
  title?: string;
  params?: RecipeParams;
  steps?: RecipeStep[];
  notes?: string;
  intent?: string[];
  beanSnapshot?: BeanSnapshot;
  adjustmentFromPrevious?: string;
}

export async function updateRecipe(
  config: SupabaseConfig,
  code: RecipeCode,
  patch: RecipeUpdate,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc | null> {
  const current = await getRecipeByCode(config, code, fetchImpl);
  if (!current) return null;

  const row: Record<string, unknown> = { version: (current.version ?? 1) + 1 };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.params !== undefined) row.params = patch.params;
  if (patch.steps !== undefined) row.steps = patch.steps;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.intent !== undefined) row.intent = patch.intent;
  if (patch.beanSnapshot !== undefined) row.bean_snapshot = patch.beanSnapshot;
  if (patch.adjustmentFromPrevious !== undefined) {
    row.adjustment_from_previous = patch.adjustmentFromPrevious;
  }

  const rows = await updateRows<RecipeRow>(config, 'recipes', eqCode(code), row, RECIPE_COLUMNS, fetchImpl);
  return rows[0] ? rowToRecipe(rows[0]) : null;
}

// ── ROB-605: soft-delete (archive) ───────────────────────────────────────────
export async function setRecipeStatus(
  config: SupabaseConfig,
  code: RecipeCode,
  status: RecipeStatus,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc | null> {
  const rows = await updateRows<RecipeRow>(config, 'recipes', eqCode(code), { status }, RECIPE_COLUMNS, fetchImpl);
  return rows[0] ? rowToRecipe(rows[0]) : null;
}

// ── ROB-609: supersede old recipe by a new one (lineage) ─────────────────────
export async function supersedeRecipe(
  config: SupabaseConfig,
  oldCode: RecipeCode,
  newCode: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<{ old: RecipeDoc | null; replacement: RecipeDoc | null }> {
  const oldRows = await updateRows<RecipeRow>(
    config,
    'recipes',
    eqCode(oldCode),
    { status: 'superseded', superseded_by: newCode },
    RECIPE_COLUMNS,
    fetchImpl
  );
  const newRows = await updateRows<RecipeRow>(
    config,
    'recipes',
    eqCode(newCode),
    { supersedes: oldCode },
    RECIPE_COLUMNS,
    fetchImpl
  );
  return {
    old: oldRows[0] ? rowToRecipe(oldRows[0]) : null,
    replacement: newRows[0] ? rowToRecipe(newRows[0]) : null,
  };
}

// ── ROB-607: near-duplicate detection at creation ────────────────────────────
function norm(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}
function numEq(a: number | undefined, b: number | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 1e-6;
}

/** A candidate is "similar" if method + bean name + dose/water/temp/ratio match. */
export function isSimilarRecipe(existing: RecipeDoc, input: CreateRecipeInput): boolean {
  if (existing.method !== input.method) return false;
  if (norm(existing.beanSnapshot?.name) !== norm(input.beanSnapshot?.name)) return false;
  const ep = existing.params ?? {};
  const ip = input.params ?? {};
  return (
    numEq(ep.doseG, ip.doseG) &&
    numEq(ep.waterG, ip.waterG) &&
    numEq(ep.tempC, ip.tempC) &&
    norm(ep.ratio) === norm(ip.ratio)
  );
}

export async function findSimilarRecipes(
  config: SupabaseConfig,
  input: CreateRecipeInput,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const recents = await listRecentRecipes(config, MAX_LIMIT, fetchImpl);
  return recents.filter((r) => isSimilarRecipe(r, input));
}
