import type {
  BeanSnapshot,
  CreateRecipeInput,
  DripperPortability,
  RecipeCode,
  RecipeDoc,
  RecipeParams,
  RecipeParamsPatch,
  RecipeStatus,
  RecipeStep,
} from '@brewdial/shared';
import type { ApiConfig } from '../config.js';
import { ApiError, getJson, postJson, patchJson, putJson } from '../api.js';
import { rowToRecipe, type RecipeRow } from '../mappers.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function createRecipe(
  config: ApiConfig,
  input: CreateRecipeInput,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc> {
  // Agent route accepts camelCase CreateRecipeInput directly (validated server-side).
  const body: Record<string, unknown> = {
    method: input.method,
    title: input.title,
  };
  if (input.beanId !== undefined) body.beanId = input.beanId;
  if (input.beanSnapshot !== undefined) body.beanSnapshot = input.beanSnapshot;
  if (input.params !== undefined) body.params = input.params;
  if (input.steps !== undefined) body.steps = input.steps;
  if (input.intent !== undefined) body.intent = input.intent;
  if (input.notes !== undefined) body.notes = input.notes;
  if (input.adjustmentFromPrevious !== undefined) body.adjustmentFromPrevious = input.adjustmentFromPrevious;
  if (input.dripperPortability !== undefined) body.dripperPortability = input.dripperPortability;
  if (input.parentCode !== undefined) body.parentCode = input.parentCode;
  const row = await postJson<RecipeRow>(config, '/api/agent/recipes', body, fetchImpl);
  return rowToRecipe(row);
}

export async function setRecipeParent(config: ApiConfig, code: RecipeCode, parentCode: RecipeCode | null, fetchImpl: typeof fetch = fetch): Promise<RecipeDoc | null> {
  try {
    const row = await putJson<RecipeRow>(config, `/api/agent/recipes/${encodeURIComponent(code)}/parent`, { parentCode }, fetchImpl);
    return rowToRecipe(row);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) return null;
    throw err;
  }
}

export async function getRecipeByCode(
  config: ApiConfig,
  code: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc | null> {
  // MCP is agent-facing: GET /api/agent/recipes/:code returns any-status recipe.
  try {
    const row = await getJson<RecipeRow>(config, `/api/agent/recipes/${encodeURIComponent(code)}`, '', fetchImpl);
    return rowToRecipe(row);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

export async function listRecipeChildren(
  config: ApiConfig,
  parentCode: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const query = new URLSearchParams({ parentCode }).toString();
  const rows = await getJson<RecipeRow[]>(config, `/api/agent/recipes?${query}`, '', fetchImpl);
  return (Array.isArray(rows) ? rows : []).map(rowToRecipe);
}

export async function listRecentRecipes(
  config: ApiConfig,
  limit: number = DEFAULT_LIMIT,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const safe = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const rows = await getJson<RecipeRow[]>(config, '/api/recipes', `limit=${safe}`, fetchImpl);
  return (Array.isArray(rows) ? rows : []).map(rowToRecipe);
}

// ── ROB-605: edit ────────────────────────────────────────────────────────────
export interface RecipeUpdate {
  title?: string;
  params?: RecipeParamsPatch;
  steps?: RecipeStep[];
  notes?: string;
  intent?: string[];
  beanSnapshot?: BeanSnapshot;
  adjustmentFromPrevious?: string;
  dripperPortability?: DripperPortability;
  /** The version the caller last read; a different stored version is refused with 409. */
  expectedVersion?: number;
  /** Preview only: return before/after/changed and write nothing. */
  dryRun?: boolean;
}

export type RecipeUpdateResult =
  | { kind: 'updated'; recipe: RecipeDoc }
  | { kind: 'dryRun'; before: RecipeDoc; after: RecipeDoc; changed: string[] };

interface RecipeDryRunPayload {
  dryRun: true;
  before: RecipeRow;
  after: RecipeRow;
  changed: string[];
}

// The API answers 409 {"error":"version_conflict","currentVersion":N} when expectedVersion is stale.
export class RecipeVersionConflictError extends Error {
  readonly currentVersion: number;
  constructor(currentVersion: number) {
    super(`version conflict: the recipe is at version ${currentVersion}`);
    this.name = 'RecipeVersionConflictError';
    this.currentVersion = currentVersion;
  }
}

function currentVersionOf(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || !('currentVersion' in body)) return undefined;
  return typeof body.currentVersion === 'number' ? body.currentVersion : undefined;
}

export async function updateRecipe(
  config: ApiConfig,
  code: RecipeCode,
  patch: RecipeUpdate,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeUpdateResult | null> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.params !== undefined) body.params = patch.params;
  if (patch.steps !== undefined) body.steps = patch.steps;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.intent !== undefined) body.intent = patch.intent;
  if (patch.beanSnapshot !== undefined) body.beanSnapshot = patch.beanSnapshot;
  if (patch.adjustmentFromPrevious !== undefined) body.adjustmentFromPrevious = patch.adjustmentFromPrevious;
  if (patch.dripperPortability !== undefined) body.dripperPortability = patch.dripperPortability;
  if (patch.expectedVersion !== undefined) body.expectedVersion = patch.expectedVersion;
  if (patch.dryRun !== undefined) body.dryRun = patch.dryRun;

  try {
    const res = await patchJson<RecipeRow | RecipeDryRunPayload>(config, `/api/agent/recipes/${encodeURIComponent(code)}`, body, fetchImpl);
    if ('dryRun' in res) {
      return { kind: 'dryRun', before: rowToRecipe(res.before), after: rowToRecipe(res.after), changed: res.changed };
    }
    return { kind: 'updated', recipe: rowToRecipe(res) };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
      return null;
    }
    if (err instanceof ApiError && err.status === 409) {
      const currentVersion = currentVersionOf(err.body);
      if (currentVersion !== undefined) throw new RecipeVersionConflictError(currentVersion);
    }
    throw err;
  }
}

// ── ROB-605: soft-delete (archive) ───────────────────────────────────────────
export async function setRecipeStatus(
  config: ApiConfig,
  code: RecipeCode,
  status: RecipeStatus,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc | null> {
  try {
    const row = await patchJson<RecipeRow>(
      config,
      `/api/agent/recipes/${encodeURIComponent(code)}/status`,
      { status },
      fetchImpl
    );
    return rowToRecipe(row);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

// ── ROB-609: supersede old recipe by a new one (lineage) ─────────────────────
export async function supersedeRecipe(
  config: ApiConfig,
  oldCode: RecipeCode,
  newCode: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<{ old: RecipeDoc | null; replacement: RecipeDoc | null }> {
  // POST /api/agent/recipes/supersede returns { old: RecipeRow, replacement: RecipeRow }
  const result = await postJson<{ old: RecipeRow | null; replacement: RecipeRow | null }>(
    config,
    '/api/agent/recipes/supersede',
    { oldCode, newCode },
    fetchImpl
  );
  return {
    old: result.old ? rowToRecipe(result.old) : null,
    replacement: result.replacement ? rowToRecipe(result.replacement) : null,
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
// Pour-structure fingerprint: ordered (atSec, cumulative waterG) pairs. Different
// pour counts / timings / amounts yield different signatures.
function stepSignature(steps: RecipeStep[] | undefined): string {
  if (!steps || steps.length === 0) return '';
  return steps
    .map((s) => `${typeof s.atSec === 'number' ? s.atSec : ''}:${typeof s.waterG === 'number' ? s.waterG : ''}`)
    .join('|');
}

/**
 * "Similar" = same method + bean + dose/water/temp/ratio AND the same pour
 * schedule (steps + targetTimeSec). ROB-610: pour structure is part of the key,
 * so intended variants on the same bean (e.g. 2-pour vs 3-pour) are NOT dupes.
 */
export function isSimilarRecipe(existing: RecipeDoc, input: CreateRecipeInput): boolean {
  if (existing.method !== input.method) return false;
  if (norm(existing.beanSnapshot?.name) !== norm(input.beanSnapshot?.name)) return false;
  const ep = existing.params ?? {};
  const ip = input.params ?? {};
  if (!numEq(ep.doseG, ip.doseG) || !numEq(ep.waterG, ip.waterG)) return false;
  if (!numEq(ep.tempC, ip.tempC) || norm(ep.ratio) !== norm(ip.ratio)) return false;
  if (!numEq(ep.targetTimeSec, ip.targetTimeSec)) return false;
  return stepSignature(existing.steps) === stepSignature(input.steps);
}

export async function findSimilarRecipes(
  config: ApiConfig,
  input: CreateRecipeInput,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const recents = await listRecentRecipes(config, MAX_LIMIT, fetchImpl);
  return recents.filter((r) => isSimilarRecipe(r, input));
}
