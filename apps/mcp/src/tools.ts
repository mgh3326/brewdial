import type { RecipeCode, RecipeStatus } from '@brewdial/shared';
import { isRecipeCode, validateCreateFeedbackInput, validateCreateRecipeInput } from '@brewdial/shared';
import type { SupabaseConfig } from './config.js';
import { buildRecentContext, buildRecipeContext, parseContextLimit } from './context.js';
import { createFeedback } from './repositories/feedback.js';
import {
  createRecipe,
  findSimilarRecipes,
  setRecipeStatus,
  supersedeRecipe,
  updateRecipe,
  type RecipeUpdate,
} from './repositories/recipes.js';
import { findBeans, listBeans } from './repositories/beans.js';
import { listGrinders } from './repositories/grinders.js';
import { listDrippers } from './repositories/drippers.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const RECIPE_STATUSES: RecipeStatus[] = ['active', 'superseded', 'archived', 'test'];

function jsonResult(obj: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}
function jsonError(obj: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], isError: true };
}
function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export async function handleCreateRecipe(
  config: SupabaseConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const validation = validateCreateRecipeInput({ ...(args ?? {}), createdBy: 'agent' });
  if (!validation.ok) {
    return jsonError({ ok: false, error: 'Invalid recipe input', details: validation.errors });
  }

  try {
    // ROB-610: dedup is a soft WARNING, never a block. Pour structure (steps +
    // targetTimeSec) is part of the similarity key, so same-bean variants are
    // allowed; we just surface possibleDuplicateOf so the agent can link lineage.
    const similar = await findSimilarRecipes(config, validation.value);
    const recipe = await createRecipe(config, validation.value);
    const out: Record<string, unknown> = {
      ok: true,
      recipe,
      display: {
        code: recipe.code,
        instruction:
          'Include this recipe code in the reply so the user can find it and give feedback later.',
      },
    };
    if (similar.length > 0) {
      out.possibleDuplicateOf = similar.map((s) => ({ code: s.code, title: s.title, status: s.status }));
      out.note = `비슷한 레시피가 있어요 (${similar
        .map((s) => s.code)
        .join(', ')}). 의도된 변형이면 supersede_recipe로 계보를 이어도 좋아요.`;
    }
    if (validation.warnings.length > 0) out.warnings = validation.warnings;
    return jsonResult(out);
  } catch (error) {
    return errorResult(`Error creating recipe: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleUpdateRecipe(
  config: SupabaseConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const code = args?.code;
  if (typeof code !== 'string' || !isRecipeCode(code)) {
    return errorResult('Invalid recipe code: expected format COF-NNNN');
  }
  const patch: RecipeUpdate = {};
  if (typeof args?.title === 'string') patch.title = args.title;
  if (args?.params && typeof args.params === 'object') patch.params = args.params as RecipeUpdate['params'];
  if (Array.isArray(args?.steps)) patch.steps = args.steps as RecipeUpdate['steps'];
  if (typeof args?.notes === 'string') patch.notes = args.notes;
  if (Array.isArray(args?.intent)) patch.intent = args.intent as string[];
  if (args?.beanSnapshot && typeof args.beanSnapshot === 'object') {
    patch.beanSnapshot = args.beanSnapshot as RecipeUpdate['beanSnapshot'];
  }
  if (typeof args?.adjustmentFromPrevious === 'string') {
    patch.adjustmentFromPrevious = args.adjustmentFromPrevious;
  }
  if (Object.keys(patch).length === 0) {
    return errorResult('No updatable fields provided (title, params, steps, notes, intent, beanSnapshot, adjustmentFromPrevious).');
  }

  try {
    const recipe = await updateRecipe(config, code as RecipeCode, patch);
    if (!recipe) return jsonResult({ ok: false, error: `Recipe ${code} not found` });
    return jsonResult({ ok: true, recipe });
  } catch (error) {
    return errorResult(`Error updating recipe: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleArchiveRecipe(
  config: SupabaseConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const code = args?.code;
  if (typeof code !== 'string' || !isRecipeCode(code)) {
    return errorResult('Invalid recipe code: expected format COF-NNNN');
  }
  const status = (typeof args?.status === 'string' ? args.status : 'archived') as RecipeStatus;
  if (!RECIPE_STATUSES.includes(status)) {
    return errorResult(`Invalid status: expected one of ${RECIPE_STATUSES.join(', ')}`);
  }
  try {
    const recipe = await setRecipeStatus(config, code as RecipeCode, status);
    if (!recipe) return jsonResult({ ok: false, error: `Recipe ${code} not found` });
    return jsonResult({ ok: true, recipe: { code: recipe.code, status: recipe.status } });
  } catch (error) {
    return errorResult(`Error archiving recipe: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleSupersedeRecipe(
  config: SupabaseConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const oldCode = args?.oldCode;
  const newCode = args?.newCode;
  if (typeof oldCode !== 'string' || !isRecipeCode(oldCode)) {
    return errorResult('Invalid oldCode: expected format COF-NNNN');
  }
  if (typeof newCode !== 'string' || !isRecipeCode(newCode)) {
    return errorResult('Invalid newCode: expected format COF-NNNN');
  }
  try {
    const result = await supersedeRecipe(config, oldCode as RecipeCode, newCode as RecipeCode);
    if (!result.old) return jsonResult({ ok: false, error: `Recipe ${oldCode} not found` });
    if (!result.replacement) return jsonResult({ ok: false, error: `Recipe ${newCode} not found` });
    return jsonResult({
      ok: true,
      superseded: { code: result.old.code, status: result.old.status, supersededBy: result.old.supersededBy },
      replacement: { code: result.replacement.code, supersedes: result.replacement.supersedes },
    });
  } catch (error) {
    return errorResult(`Error superseding recipe: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleFindBean(
  config: SupabaseConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) return errorResult('find_bean: a non-empty "query" is required.');
  const limit = typeof args?.limit === 'number' ? Math.max(1, Math.min(25, Math.floor(args.limit))) : 10;
  try {
    const beans = await findBeans(config, query, limit);
    return jsonResult({ ok: true, count: beans.length, beans });
  } catch (error) {
    return errorResult(`Error finding beans: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleListBeans(
  config: SupabaseConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const limit = typeof args?.limit === 'number' ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 20;
  try {
    const beans = await listBeans(config, limit);
    return jsonResult({ ok: true, count: beans.length, beans });
  } catch (error) {
    return errorResult(`Error listing beans: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleListGrinders(
  config: SupabaseConfig,
  _args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  try {
    const grinders = await listGrinders(config);
    return jsonResult({ ok: true, count: grinders.length, grinders });
  } catch (error) {
    return errorResult(`Error listing grinders: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleListDrippers(
  config: SupabaseConfig,
  _args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  try {
    const drippers = await listDrippers(config);
    return jsonResult({ ok: true, count: drippers.length, drippers });
  } catch (error) {
    return errorResult(`Error listing drippers: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleCreateFeedback(
  config: SupabaseConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const validation = validateCreateFeedbackInput(args ?? {});
  if (!validation.ok) {
    return jsonError({ ok: false, error: 'Invalid feedback input', details: validation.errors });
  }

  const value = validation.value;
  if (value.source === undefined) value.source = 'coffee_profile';

  try {
    const feedback = await createFeedback(config, value);
    return jsonResult({
      ok: true,
      feedback: {
        _id: feedback._id,
        recipeCode: feedback.recipeCode,
        rawComment: feedback.rawComment ?? feedback.comment ?? null,
        quickTags: feedback.quickTags ?? [],
        ratings: feedback.ratings ?? null,
        source: feedback.source,
        createdAt: feedback.createdAt,
      },
    });
  } catch (error) {
    return errorResult(`Error creating feedback: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleGetRecentContext(
  config: SupabaseConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const rawLimit = args?.limit;
  const limit = typeof rawLimit === 'number' ? rawLimit : undefined;
  const safeLimit = parseContextLimit(limit);
  try {
    const context = await buildRecentContext(config, safeLimit);
    return jsonResult(context);
  } catch (error) {
    return errorResult(`Error fetching recent context: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleGetRecipeContext(
  config: SupabaseConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const code = args?.code;
  if (typeof code !== 'string' || !isRecipeCode(code)) {
    return errorResult('Invalid recipe code: expected format COF-NNNN (e.g., COF-0001)');
  }
  try {
    const context = await buildRecipeContext(config, code as RecipeCode);
    if (!context) return jsonResult({ found: false, code });
    return jsonResult(context);
  } catch (error) {
    return errorResult(`Error fetching recipe context: ${error instanceof Error ? error.message : String(error)}`);
  }
}
