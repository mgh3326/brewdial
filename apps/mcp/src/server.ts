// BrewDial MCP server factory. Holds the tool list and the dispatch so the
// stdio bin (index.ts) and any other host (e.g. the API's /mcp route) can build
// the same server. No import-time side effects: no Sentry, no env reads.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';
import type { ApiConfig } from './config.js';
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

export interface BrewdialMcpServerOptions {
  /** Called once per thrown tool-handler error, with the tool name, before the error is rethrown. */
  onToolError?: (error: unknown, toolName: string) => void;
}

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
    bypass: {
      type: 'object',
      description: 'xBloom 바이패스 물은 5-100ml입니다. 기기는 100ml 초과 값을 100ml로 제한합니다. 업데이트 시 params 키 하나로 통째로 교체하며 null이면 제거합니다.',
      required: ['waterG'],
      properties: {
        waterG: { type: 'number', minimum: 5, maximum: 100, description: 'xBloom 기기 범위는 5-100ml이며, 초과 값은 100ml로 제한됩니다.' },
        tempC: { type: 'number', minimum: 0, maximum: 100 }
      }
    },
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
    'Dripper-portable layer: fixed anchors (ratio/temp/time) plus per-dripper class, size match, and grind/pour adjustment directions (not absolute values).',
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
  description: 'xBloom 기기는 레시피당 최대 9회 붓기를 지원합니다. 여러 rpm 값을 보내도 첫 붓기의 rpm을 전체 추출에 적용합니다.',
  items: {
    type: 'object',
    properties: {
      atSec: { type: 'number', description: "When this step's action starts, in seconds" },
      endSec: { type: 'number', description: "When this step's pour ends (exclusive), in seconds. Optional." },
      waterG: { type: 'number', description: 'Cumulative target water (g) at the end of this step' },
      pourRateGPerSec: { type: 'number', description: 'Optional pour rate; overrides the rate derived from (waterG, atSec, endSec)' },
      pattern: { type: 'string', enum: ['center', 'spiral', 'ring'], description: 'xBloom 물줄기 패턴; note 태그 대신 구조화 필드 사용' },
      rpm: {
        description: 'xBloom 진동 모터 회전수: 0 또는 60–120, 10 단위. 기기는 레시피당 rpm을 한 번만 받아 첫 붓기의 값을 전체 추출에 적용합니다.',
        oneOf: [
          { const: 0 },
          { type: 'integer', minimum: 60, maximum: 120, multipleOf: 10 }
        ]
      },
      vibrationBefore: { type: 'boolean', description: '붓기 전 xBloom 진동 여부' },
      vibrationAfter: { type: 'boolean', description: '붓기 후 xBloom 진동 여부' },
      pauseSec: { type: 'integer', minimum: 0, maximum: 127, description: '다음 붓기까지 대기 시간(초). xBloom 기기 한계는 0-127초입니다.' },
      tempC: { type: 'number', minimum: 40, maximum: 95, description: 'xBloom 물 온도(°C). 첫 붓기는 params.tempC가 우선하며, 값이 없을 때만 이 값을 사용합니다. 둘 다 제공하면 같은 값이어야 합니다.' },
      note: { type: 'string' }
    },
    required: ['note']
  }
} as const;

const TOOLS: Tool[] = [
  {
    name: 'create_recipe',

    title: 'Create Recipe',

    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description:
      '새 커피 레시피를 BrewDial에 저장합니다. 기존 원두에 연결하려면 find_bean으로 찾아 beanSnapshot에 정확한 원두명과 로스터를 넣거나 beanId를 전달하세요. 비슷한 레시피가 있어도 생성은 막히지 않으며, 응답의 possibleDuplicateOf에 경고로 표시됩니다. 의도된 변형은 supersede_recipe로 계보를 연결할 수 있습니다. 각 단계에는 atSec, waterG, note와 선택적 endSec, pourRateGPerSec를 지정합니다. xBloom 레시피는 pattern, rpm, vibrationBefore, vibrationAfter, pauseSec, tempC와 params.bypass를 구조화 필드로 전달하세요. 기기는 레시피당 최대 9회 붓기를 지원하고, rpm은 첫 붓기의 값을 전체 추출에 적용합니다. pauseSec는 0-127초이며 바이패스 물은 5-100ml입니다(100ml 초과 값은 100ml로 제한됩니다). 이 필드들은 note 태그를 대체합니다. params.grind는 문자열 또는 구조화 객체 { target: { brewMethodPosition, targetDrawdownSec, microns }, perGrinder: [{ grinder, clicks, source: "measured" }], legacyText }입니다. target에는 brewMethodPosition 또는 targetDrawdownSec가 필요하며 microns는 참고값입니다. perGrinder의 그라인더명은 list_grinders 결과와 정확히 일치해야 앱이 다른 그라인더의 클릭 수로 변환할 수 있습니다. 드리퍼 간 이식성은 dripperPortability = { origin: { dripper, sizeModel? }, anchors: { ratio, tempC, targetDrawdownSec } }로 지정하고 origin.dripper는 list_drippers 결과와 정확히 일치시킵니다. 앱은 드리퍼 크기 적합성, 분쇄도/푸어 방향, 40g 이상 도징의 베드 넘침 경고를 조회 시 계산하므로 params.doseG도 지정하세요.',
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
    name: 'update_recipe',

    title: 'Update Recipe',

    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description:
      '기존 레시피를 수정합니다. params는 최상위 키별로 병합되며 전달한 값은 교체되고 null은 제거됩니다. params.bypass는 하나의 키로 통째로 교체됩니다. xBloom 단계의 구조화 필드(pattern, rpm, vibrationBefore, vibrationAfter, pauseSec, tempC)는 note 태그를 대체합니다. 기기는 레시피당 최대 9회 붓기를 지원하고, rpm은 첫 붓기의 값을 전체 추출에 적용합니다. pauseSec는 0-127초이며 바이패스 물은 5-100ml입니다(100ml 초과 값은 100ml로 제한됩니다). steps, intent, notes 및 기타 필드는 전체 교체됩니다. expectedVersion으로 동시 변경을 확인하고 dryRun: true로 쓰기 전에 미리 볼 수 있습니다.',
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
        dripperPortability: DRIPPER_PORTABILITY_SCHEMA,
        expectedVersion: { type: 'integer', minimum: 1, description: 'The version you last read. If the stored version differs, nothing is written and the error names the current version.' },
        dryRun: { type: 'boolean', description: 'Return { before, after, changed } and write nothing (no version bump).' }
      },
      required: ['code']
    }
  },
  {
    name: 'archive_recipe',

    title: 'Archive Recipe',

    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description:
      "Soft-delete or re-status a recipe. Default sets status='archived' so it disappears from the mini-app list/deep links without deleting data. status can also be active/test/superseded/reference.",
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Recipe code, format COF-NNNN' },
        status: { type: 'string', enum: ['active', 'superseded', 'archived', 'test', 'reference'], description: "Defaults to 'archived'" }
      },
      required: ['code']
    }
  },
  {
    name: 'supersede_recipe',

    title: 'Supersede Recipe',

    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description:
      'Mark an old recipe as superseded by a newer one. Sets old.status=superseded + old.supersededBy=newCode and new.supersedes=oldCode. The old one drops out of the active list while staying reachable via its code.',
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
    name: 'find_bean',

    title: 'Find Bean',

    annotations: { readOnlyHint: true, openWorldHint: false },
    description:
      'Search existing beans by name/roaster substring. Use it before create_recipe to attach a new recipe onto an existing bean instead of creating a duplicate. Returns id/name/roaster/origin/process/roastLevel + recipeCount (most recipes first).',
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
    name: 'list_beans',

    title: 'List Beans',

    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List recently-active beans (no query needed). Same shape as find_bean.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '1-50, default 20' } }
    }
  },
  {
    name: 'update_bean_attributes',

    title: 'Update Bean Attributes',

    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description:
      'Set structured tasting attributes on an existing bean so future "what should I buy next?" recommendations can score it by axis. Get beanId from find_bean or list_beans. Only normalized attribute columns are written here — name/roaster/origin are owned by recipes. The 1..5 scales (roastLevelOrd, acidity, body) are your own single-rubric judgment, because roaster self-reported numbers use inconsistent scales; preserve the roaster’s original wording/numbers verbatim in attrsNotes as evidence, and anchor roastLevelOrd to Agtron when known. Provide at least one attribute.',
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
    name: 'list_grinders',

    title: 'List Grinders',

    annotations: { readOnlyHint: true, openWorldHint: false },
    description:
      'List the grinder registry: canonical name, per-method click band (brewMethodRanges, e.g. v60: {from,to}), advisory um/click, and stepless flag. Use it before create_recipe so params.grind.perGrinder spells the grinder exactly as the registry does (e.g. "KINGrinder K6", "Comandante C40") — the mini-app converts clicks to other grinders at read time only when names match the registry.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_drippers',

    title: 'List Drippers',

    annotations: { readOnlyHint: true, openWorldHint: false },
    description:
      'List the dripper registry: canonical name, class (bed_restricted/dripper_restricted/hybrid/immersion), flow-restriction continuum (0 fast/bed-controlled .. 1 slow/dripper-controlled), recommendedDoseRange, and sizeModels (maxDoseG). Use it before create_recipe so dripperPortability.origin.dripper spells the dripper exactly as the registry does — the mini-app derives per-dripper size match + grind/pour direction + the 40g bed-overflow warning at read time from these values.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_recent_context',

    title: 'Get Recent Context',

    annotations: { readOnlyHint: true, openWorldHint: false },
    description:
      'Get recent BrewDial state in one read-only call: the newest recipes (limit, default 5, clamped to 1-20), each with its full feedback list and a feedbackSummary (count, averageOverall, commonDesiredDirections, latestRawComment = the words the user wrote, verbatim, or null, latestComment = a note that may be an agent summary or interpretation, latestQuickTags, latestSource), plus global taste preferences, totals, and guidance — a short list of plain-text hints such as "no feedback yet" or "average overall below 3". Use get_recipe_context to look at one recipe by code.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of recent recipes to include (1-20, default: 5)' }
      }
    }
  },
  {
    name: 'get_recipe_context',

    title: 'Get Recipe Context',

    annotations: { readOnlyHint: true, openWorldHint: false },
    description:
      'Get one recipe by COF-NNNN code with what is needed to dial it in, read-only: the full recipe, all its feedback, a feedbackSummary, global taste preferences, and a guidance list of plain-text hints. An unknown code returns { found: false, code } rather than an error.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Recipe code in format COF-NNNN (e.g., COF-0001)' }
      },
      required: ['code']
    }
  },
  {
    name: 'create_feedback',

    title: 'Create Feedback',

    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description:
      "Save a tasting/feedback note for a BrewDial recipe. At least one of rawComment, ratings, or quickTags is required. Prefer rawComment for the user's own words. Returned rawComment is the user's own words, verbatim, or null; returned comment (when present) is a note that may be an agent's summary or interpretation, not the user's words. Returns the persisted feedback summary.",
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
        source: { type: 'string', enum: ['coffee_profile', 'agent', 'mcp', 'api'], description: 'Defaults to coffee_profile for this tool.' },
        desiredDirection: { type: 'array', items: { type: 'string' } },
        nextHint: { type: 'array', items: { type: 'string' } }
      },
      required: ['recipeCode']
    }
  },
  {
    name: 'update_preferences',

    title: 'Update Preferences',

    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
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

export function createBrewdialMcpServer(
  api: ApiConfig,
  opts: BrewdialMcpServerOptions = {}
): Server {
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
        case 'create_recipe': result = await handleCreateRecipe(api, a); break;
        case 'update_recipe': result = await handleUpdateRecipe(api, a); break;
        case 'archive_recipe': result = await handleArchiveRecipe(api, a); break;
        case 'supersede_recipe': result = await handleSupersedeRecipe(api, a); break;
        case 'find_bean': result = await handleFindBean(api, a); break;
        case 'list_beans': result = await handleListBeans(api, a); break;
        case 'update_bean_attributes': result = await handleUpdateBeanAttributes(api, a); break;
        case 'list_grinders': result = await handleListGrinders(api, a); break;
        case 'list_drippers': result = await handleListDrippers(api, a); break;
        case 'get_recent_context': result = await handleGetRecentContext(api, a); break;
        case 'get_recipe_context': result = await handleGetRecipeContext(api, a); break;
        case 'create_feedback': result = await handleCreateFeedback(api, a); break;
        case 'update_preferences': result = await handleUpdatePreferences(api, a); break;
        default:
          result = { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (error) {
      // The MCP SDK turns a thrown handler into a generic error response; let the
      // host observe it (with the tool name) before rethrowing.
      opts.onToolError?.(error, name);
      throw error;
    }
    return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
  });

  return server;
}
