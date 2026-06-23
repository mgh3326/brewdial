#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';
import { getMcpConfig } from './config.js';
import {
  handleArchiveRecipe,
  handleCreateFeedback,
  handleCreateRecipe,
  handleFindBean,
  handleGetRecentContext,
  handleGetRecipeContext,
  handleListBeans,
  handleListGrinders,
  handleSupersedeRecipe,
  handleUpdateRecipe,
  type ToolResult
} from './tools.js';

const BEAN_SNAPSHOT_SCHEMA = {
  type: 'object',
  description: 'Bean metadata snapshot',
  properties: {
    name: { type: 'string' },
    roaster: { type: 'string' },
    roastDate: { type: 'string' },
    roastLevel: { type: 'string' },
    origin: { type: 'string' },
    process: { type: 'string' },
    notes: { type: 'string' }
  }
} as const;

const PARAMS_SCHEMA = {
  type: 'object',
  description: 'Brew parameters',
  properties: {
    doseG: { type: 'number' },
    waterG: { type: 'number' },
    ratio: { type: 'string' },
    tempC: { type: 'number' },
    grind: {
      // ROB-611: legacy free text OR structured grinder-portable spec.
      oneOf: [
        { type: 'string' },
        {
          type: 'object',
          required: ['target'],
          properties: {
            target: {
              type: 'object',
              description:
                'Grinder-agnostic target. Prefer brewMethodPosition + targetDrawdownSec; microns is advisory only.',
              properties: {
                microns: { type: 'number' },
                brewMethodPosition: { type: 'string' },
                targetDrawdownSec: { type: 'number' }
              }
            },
            perGrinder: {
              type: 'array',
              items: {
                type: 'object',
                required: ['grinder', 'clicks', 'source'],
                properties: {
                  grinder: { type: 'string' },
                  grinderId: { type: 'string' },
                  clicks: { type: ['number', 'string'] },
                  stepless: { type: 'boolean' },
                  source: { type: 'string', enum: ['measured', 'dial-in-start'] }
                }
              }
            },
            legacyText: { type: 'string' }
          }
        }
      ]
    },
    grinder: { type: 'string' },
    brewer: { type: 'string' },
    targetTimeSec: { type: 'number' }
  }
} as const;

const STEPS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      atSec: { type: 'number', description: "When this step's action starts, in seconds" },
      endSec: { type: 'number', description: "When this step's pour ends (exclusive), in seconds. Optional." },
      waterG: { type: 'number', description: 'Cumulative target water (g) at the end of this step' },
      pourRateGPerSec: { type: 'number', description: 'Optional pour rate; overrides the rate derived from (waterG, atSec, endSec)' },
      note: { type: 'string' }
    },
    required: ['note']
  }
} as const;

const TOOLS: Tool[] = [
  {
    name: 'brew.create_recipe',
    description:
      'Persist a newly generated coffee recipe to BrewDial (Supabase). It appears in the App-in-Toss mini-app immediately, grouped under its bean. Returns the COF-NNNN code. To map onto an EXISTING bean (avoid duplicate beans), first call brew.find_bean and reuse the matched bean’s exact name+roaster in beanSnapshot (or pass beanId). If a near-identical recipe exists it is STILL created and the response includes possibleDuplicateOf as a soft warning (link variants with supersede_recipe). Steps may include atSec/endSec/waterG/pourRateGPerSec; legacy {atSec,waterG,note} steps remain valid. GRIND (ROB-611): prefer a STRUCTURED params.grind object over free text — { target: { brewMethodPosition e.g. "v60 medium-fine", targetDrawdownSec }, perGrinder: [{ grinder, clicks, source: "measured" }], legacyText }. target MUST carry brewMethodPosition OR targetDrawdownSec (microns is advisory only). Put the operator’s MEASURED grinder+clicks in perGrinder; first call brew.list_grinders and use the EXACT registry name so the app can convert clicks to other grinders at read time. Keep the original wording in legacyText. A plain string grind is still accepted for legacy/quick entry.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['v60', 'espresso', 'aeropress', 'kalita', 'other'], description: 'Brew method' },
        title: { type: 'string', description: 'Human-readable recipe title' },
        beanId: { type: 'string', description: 'Optional stable bean identifier' },
        beanSnapshot: BEAN_SNAPSHOT_SCHEMA,
        params: PARAMS_SCHEMA,
        steps: STEPS_SCHEMA,
        intent: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        adjustmentFromPrevious: { type: 'string' }
      },
      required: ['method', 'title']
    }
  },
  {
    name: 'brew.update_recipe',
    description:
      'Edit an existing recipe in place (ROB-605). Provide the COF-NNNN code and any fields to change; version is bumped automatically. Use this to fix a recipe rather than creating a near-duplicate. params.grind may be upgraded from a legacy string to a structured GrindSpec (see create_recipe / ROB-611).',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Recipe code, format COF-NNNN' },
        title: { type: 'string' },
        params: PARAMS_SCHEMA,
        steps: STEPS_SCHEMA,
        notes: { type: 'string' },
        intent: { type: 'array', items: { type: 'string' } },
        beanSnapshot: BEAN_SNAPSHOT_SCHEMA,
        adjustmentFromPrevious: { type: 'string' }
      },
      required: ['code']
    }
  },
  {
    name: 'brew.archive_recipe',
    description:
      "Soft-delete or re-status a recipe (ROB-605). Default sets status='archived' so it disappears from the mini-app list/deep links without deleting data. status can also be active/test/superseded.",
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Recipe code, format COF-NNNN' },
        status: { type: 'string', enum: ['active', 'superseded', 'archived', 'test'], description: "Defaults to 'archived'" }
      },
      required: ['code']
    }
  },
  {
    name: 'brew.supersede_recipe',
    description:
      'Mark an old recipe as superseded by a newer one (ROB-609 lineage). Sets old.status=superseded + old.supersededBy=newCode and new.supersedes=oldCode. The old one drops out of the active list while staying reachable via its code.',
    inputSchema: {
      type: 'object',
      properties: {
        oldCode: { type: 'string', description: 'Recipe being replaced, format COF-NNNN' },
        newCode: { type: 'string', description: 'Replacement recipe, format COF-NNNN' }
      },
      required: ['oldCode', 'newCode']
    }
  },
  {
    name: 'brew.find_bean',
    description:
      'Search existing beans by name/roaster substring. Call this BEFORE create_recipe to map a new recipe onto an existing bean instead of creating a duplicate. Returns id/name/roaster/origin/process/roastLevel + recipeCount (most recipes first).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Bean name or roaster fragment (e.g. "브릴리", "디카프리오")' },
        limit: { type: 'number', description: '1-25, default 10' }
      },
      required: ['query']
    }
  },
  {
    name: 'brew.list_beans',
    description: 'List recently-active beans (no query needed). Same shape as find_bean.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '1-50, default 20' } }
    }
  },
  {
    name: 'brew.list_grinders',
    description:
      'List the grinder registry (ROB-611): canonical name, per-method click band (brewMethodRanges, e.g. v60: {from,to}), advisory um/click, and stepless flag. Call this BEFORE create_recipe so params.grind.perGrinder uses the EXACT registry name (e.g. "KINGrinder K6", "Comandante C40") — the mini-app only converts clicks to other grinders at read time when names match the registry.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'brew.get_recent_context',
    description: 'Get recent BrewDial context including recipes, feedback, and guidance',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of recent recipes to include (1-20, default: 5)' }
      }
    }
  },
  {
    name: 'brew.get_recipe_context',
    description: 'Get detailed context for a specific recipe by code',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Recipe code in format COF-NNNN (e.g., COF-0001)' }
      },
      required: ['code']
    }
  },
  {
    name: 'brew.create_feedback',
    description:
      "Save a tasting/feedback note for a BrewDial recipe. At least one of rawComment, ratings, or quickTags is required. Prefer rawComment for the user's own words. Returns the persisted feedback summary.",
    inputSchema: {
      type: 'object',
      properties: {
        recipeCode: { type: 'string', description: 'Recipe code, format COF-NNNN' },
        rawComment: { type: 'string', description: "User's own wording about the brew. Preserved verbatim." },
        quickTags: {
          type: 'array',
          items: { type: 'string', enum: ['고소함', '견과류', '쓴맛', '산미', '떫음', '묽음', '진함', '좋았음', '아쉬움'] },
          description: 'Optional fixed-vocabulary quick tags.'
        },
        ratings: {
          type: 'object',
          description: 'Optional numeric ratings; same keys as web form.',
          properties: {
            overall: { type: 'integer', minimum: 1, maximum: 5 },
            sweetness: { type: 'integer', minimum: 0, maximum: 4 },
            burnt: { type: 'integer', minimum: 0, maximum: 4 },
            bitter: { type: 'integer', minimum: 0, maximum: 4 },
            sour: { type: 'integer', minimum: 0, maximum: 4 },
            body: { type: 'integer', minimum: 0, maximum: 4 },
            astringency: { type: 'integer', minimum: 0, maximum: 4 },
            clarity: { type: 'integer', minimum: 0, maximum: 4 }
          }
        },
        source: { type: 'string', enum: ['web', 'coffee_profile', 'api', 'agent', 'mcp'], description: 'Defaults to coffee_profile for this tool.' },
        desiredDirection: { type: 'array', items: { type: 'string' } },
        nextHint: { type: 'array', items: { type: 'string' } }
      },
      required: ['recipeCode']
    }
  }
];

async function main(): Promise<void> {
  const config = getMcpConfig();
  const supabase = config.supabase;

  const server = new Server(
    { name: 'brewdial-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = args as Record<string, unknown> | undefined;
    let result: ToolResult;
    switch (name) {
      case 'brew.create_recipe': result = await handleCreateRecipe(supabase, a); break;
      case 'brew.update_recipe': result = await handleUpdateRecipe(supabase, a); break;
      case 'brew.archive_recipe': result = await handleArchiveRecipe(supabase, a); break;
      case 'brew.supersede_recipe': result = await handleSupersedeRecipe(supabase, a); break;
      case 'brew.find_bean': result = await handleFindBean(supabase, a); break;
      case 'brew.list_beans': result = await handleListBeans(supabase, a); break;
      case 'brew.list_grinders': result = await handleListGrinders(supabase, a); break;
      case 'brew.get_recent_context': result = await handleGetRecentContext(supabase, a); break;
      case 'brew.get_recipe_context': result = await handleGetRecipeContext(supabase, a); break;
      case 'brew.create_feedback': result = await handleCreateFeedback(supabase, a); break;
      default:
        result = { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('BrewDial MCP server running on stdio (Supabase)');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
