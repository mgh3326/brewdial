#!/usr/bin/env node
import './instrument.js'; // must be first — initialises Sentry before any other module
import * as Sentry from '@sentry/node';
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
  handleListDrippers,
  handleListGrinders,
  handleSupersedeRecipe,
  handleUpdatePreferences,
  handleUpdateBeanAttributes,
  handleUpdateRecipe,
  type ToolResult
} from './tools.js';
import { BEAN_ATTRS_SOURCES, BEAN_FLAVOR_CATEGORIES, TASTE_TAGS } from '@brewdial/shared';

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

const DRIPPER_PORTABILITY_SCHEMA = {
  type: 'object',
  description:
    'ROB-612 dripper-portable layer: fixed anchors (ratio/temp/time) + per-dripper class, size match, and grind/pour adjustment DIRECTIONS (not absolute values).',
  required: ['origin'],
  properties: {
    origin: {
      type: 'object',
      required: ['dripper'],
      properties: {
        dripper: { type: 'string' },
        dripperId: { type: 'string' },
        sizeModel: { type: 'string' }
      }
    },
    anchors: {
      type: 'object',
      properties: {
        ratio: { type: 'string' },
        tempC: { type: 'number' },
        targetDrawdownSec: { type: 'number' }
      }
    },
    classNote: { type: 'string' },
    targets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['dripper', 'class', 'sizeMatch', 'grindShift', 'pourShift', 'confidence'],
        properties: {
          dripper: { type: 'string' },
          dripperId: { type: 'string' },
          class: { type: 'string', enum: ['bed_restricted', 'dripper_restricted', 'hybrid', 'immersion'] },
          sizeMatch: { type: 'string', enum: ['ok', 'undersized', 'oversized'] },
          bedDepthShift: { type: 'string', enum: ['shallower', 'deeper', 'similar'] },
          bedOverflow: { type: 'boolean' },
          grindShift: { type: 'string', enum: ['coarser', 'finer', 'none'] },
          pourShift: {
            type: 'string',
            enum: ['gentler', 'more_agitation', 'fewer_pours', 'more_pours', 'none']
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          warn: { type: 'string' },
          note: { type: 'string' }
        }
      }
    }
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
      'Persist a newly generated coffee recipe to BrewDial. It appears in the App-in-Toss mini-app immediately, grouped under its bean. Returns the COF-NNNN code. To map onto an EXISTING bean (avoid duplicate beans), first call brew.find_bean and reuse the matched bean’s exact name+roaster in beanSnapshot (or pass beanId). If a near-identical recipe exists it is STILL created and the response includes possibleDuplicateOf as a soft warning (link variants with supersede_recipe). Steps may include atSec/endSec/waterG/pourRateGPerSec; legacy {atSec,waterG,note} steps remain valid. GRIND (ROB-611): prefer a STRUCTURED params.grind object over free text — { target: { brewMethodPosition e.g. "v60 medium-fine", targetDrawdownSec }, perGrinder: [{ grinder, clicks, source: "measured" }], legacyText }. target MUST carry brewMethodPosition OR targetDrawdownSec (microns is advisory only). Put the operator’s MEASURED grinder+clicks in perGrinder; first call brew.list_grinders and use the EXACT registry name so the app can convert clicks to other grinders at read time. Keep the original wording in legacyText. A plain string grind is still accepted for legacy/quick entry. DRIPPER (ROB-612): for portability across drippers, set top-level dripperPortability = { origin: { dripper, sizeModel? }, anchors: { ratio, tempC, targetDrawdownSec } } — the app derives per-dripper size match + grind/pour DIRECTION + the 40g bed-overflow warning at read time. Call brew.list_drippers and use the EXACT registry name in origin.dripper. params.doseG drives the bed check, so set it (especially for 40g+ large doses).',
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
        adjustmentFromPrevious: { type: 'string' },
        dripperPortability: DRIPPER_PORTABILITY_SCHEMA
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
        adjustmentFromPrevious: { type: 'string' },
        dripperPortability: DRIPPER_PORTABILITY_SCHEMA
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
    name: 'brew.update_bean_attributes',
    description:
      'Set structured tasting attributes on an EXISTING bean (ROB-654) so future "what should I buy next?" recommendations can score it by axis. Get beanId from brew.find_bean / brew.list_beans FIRST. Only normalized attribute columns are written here — name/roaster/origin are owned by recipes. The 1..5 scales (roastLevelOrd, acidity, body) are YOUR single-rubric judgment (roaster self-reported numbers use inconsistent scales); preserve the roaster’s original wording/numbers verbatim in attrsNotes as evidence, and anchor roastLevelOrd to Agtron when known. Provide at least one attribute.',
    inputSchema: {
      type: 'object',
      properties: {
        beanId: { type: 'string', description: 'Bean id from find_bean/list_beans' },
        roastLevelOrd: { type: 'integer', minimum: 1, maximum: 5, description: '1 light .. 5 dark' },
        agtronMin: { type: 'integer', minimum: 0, maximum: 150, description: 'Agtron range low (e.g. 57)' },
        agtronMax: { type: 'integer', minimum: 0, maximum: 150, description: 'Agtron range high (e.g. 59); must be >= agtronMin' },
        acidity: { type: 'integer', minimum: 1, maximum: 5, description: '1 low .. 5 high' },
        body: { type: 'integer', minimum: 1, maximum: 5, description: '1 light .. 5 heavy' },
        decaf: { type: 'boolean', description: 'true if decaffeinated' },
        flavorCategories: {
          type: 'array',
          items: { type: 'string', enum: [...BEAN_FLAVOR_CATEGORIES] },
          description: 'SCA flavor wheel inner ring (subset of the 9)'
        },
        attrsSource: { type: 'string', enum: [...BEAN_ATTRS_SOURCES], description: 'Where the attributes came from' },
        sourceUrl: { type: 'string', description: 'Roaster/product page URL the attrs came from' },
        attrsNotes: { type: 'string', description: "Roaster's original notation/numbers, verbatim (drift evidence)" }
      },
      required: ['beanId']
    }
  },
  {
    name: 'brew.list_grinders',
    description:
      'List the grinder registry (ROB-611): canonical name, per-method click band (brewMethodRanges, e.g. v60: {from,to}), advisory um/click, and stepless flag. Call this BEFORE create_recipe so params.grind.perGrinder uses the EXACT registry name (e.g. "KINGrinder K6", "Comandante C40") — the mini-app only converts clicks to other grinders at read time when names match the registry.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'brew.list_drippers',
    description:
      'List the dripper registry (ROB-612): canonical name, class (bed_restricted/dripper_restricted/hybrid/immersion), flow-restriction continuum (0 fast/bed-controlled .. 1 slow/dripper-controlled), recommendedDoseRange, and sizeModels (maxDoseG). Call this BEFORE create_recipe so dripperPortability.origin.dripper uses the EXACT registry name — the mini-app derives per-dripper size match + grind/pour direction + the 40g bed-overflow warning at read time from these values.',
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
  },
  {
    name: 'brew.update_preferences',
    description:
      'Replace BrewDial global taste preferences through the agent-only API. Likes and dislikes must use the canonical taste-tag vocabulary; omitted arrays default to empty.',
    inputSchema: {
      type: 'object',
      properties: {
        likes: { type: 'array', items: { type: 'string', enum: [...TASTE_TAGS] } },
        dislikes: { type: 'array', items: { type: 'string', enum: [...TASTE_TAGS] } }
      }
    }
  }
];

async function main(): Promise<void> {
  const config = getMcpConfig();
  const api = config.api;

  const server = new Server(
    { name: 'brewdial-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = args as Record<string, unknown> | undefined;
    let result: ToolResult;
    try {
      switch (name) {
        case 'brew.create_recipe': result = await handleCreateRecipe(api, a); break;
        case 'brew.update_recipe': result = await handleUpdateRecipe(api, a); break;
        case 'brew.archive_recipe': result = await handleArchiveRecipe(api, a); break;
        case 'brew.supersede_recipe': result = await handleSupersedeRecipe(api, a); break;
        case 'brew.find_bean': result = await handleFindBean(api, a); break;
        case 'brew.list_beans': result = await handleListBeans(api, a); break;
        case 'brew.update_bean_attributes': result = await handleUpdateBeanAttributes(api, a); break;
        case 'brew.list_grinders': result = await handleListGrinders(api, a); break;
        case 'brew.list_drippers': result = await handleListDrippers(api, a); break;
        case 'brew.get_recent_context': result = await handleGetRecentContext(api, a); break;
        case 'brew.get_recipe_context': result = await handleGetRecipeContext(api, a); break;
        case 'brew.create_feedback': result = await handleCreateFeedback(api, a); break;
        case 'brew.update_preferences': result = await handleUpdatePreferences(api, a); break;
        default:
          result = { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (error) {
      // The MCP SDK turns a thrown handler into a generic error response, so
      // capture it here (tagged with the tool) before rethrowing.
      Sentry.captureException(error, { tags: { mcp_tool: name } });
      throw error;
    }
    return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('BrewDial MCP server running on stdio (agent API)');
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  Sentry.captureException(error);
  // Give the SDK a moment to deliver the event before the process exits.
  await Sentry.close(2000);
  process.exit(1);
});
