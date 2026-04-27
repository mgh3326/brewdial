import type { RecipeCode } from '@brewdial/shared';
import { isRecipeCode, validateCreateRecipeInput } from '@brewdial/shared';
import type { CouchConfig } from './config.js';
import { buildRecentContext, buildRecipeContext, parseContextLimit } from './context.js';
import { createRecipe } from './repositories/recipes.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function handleCreateRecipe(
  config: CouchConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const validation = validateCreateRecipeInput({ ...(args ?? {}), createdBy: 'agent' });
  if (!validation.ok) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ok: false, error: 'Invalid recipe input', details: validation.errors },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }

  try {
    const recipe = await createRecipe(config, validation.value);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              recipe,
              display: {
                code: recipe.code,
                instruction:
                  'Include this recipe code in the Discord reply so the user can find and give feedback later.'
              }
            },
            null,
            2
          )
        }
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error creating recipe: ${message}` }],
      isError: true
    };
  }
}

export async function handleGetRecentContext(
  config: CouchConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const rawLimit = args?.limit;
  const limit = typeof rawLimit === 'number' ? rawLimit : undefined;
  const safeLimit = parseContextLimit(limit);

  try {
    const context = await buildRecentContext(config, safeLimit);
    return {
      content: [{ type: 'text', text: JSON.stringify(context, null, 2) }]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error fetching recent context: ${message}` }],
      isError: true
    };
  }
}

export async function handleGetRecipeContext(
  config: CouchConfig,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const code = args?.code;

  if (typeof code !== 'string' || !isRecipeCode(code)) {
    return {
      content: [{ type: 'text', text: `Invalid recipe code: expected format COF-NNNN (e.g., COF-0001)` }],
      isError: true
    };
  }

  try {
    const context = await buildRecipeContext(config, code as RecipeCode);
    if (!context) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ found: false, code }, null, 2) }]
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(context, null, 2) }]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error fetching recipe context: ${message}` }],
      isError: true
    };
  }
}
