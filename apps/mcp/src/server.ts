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
  handleUpdateFeedback,
  handleCreateRecipe,
  handleFindBean,
  handleGetRecentContext,
  handleGetRecipeContext,
  handleReviewRecipe,
  handleListBeans,
  handleListDrippers,
  handleListGrinders,
  handleSupersedeRecipe,
  handleSetRecipeParent,
  handleUpdatePreferences,
  handleUpdateBeanAttributes,
  handleUpdateRecipe,
  handleListBrews,
  handleGetBrew,
  handleLinkXBloomRecipe,
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
    components: { type: 'array', minItems: 1, maxItems: 4, description: '블렌드 구성. doseG가 있으면 각 grams의 합이 0.05g 이내로 일치해야 합니다. 업데이트에서 null을 전달하면 제거합니다.', items: { type: 'object', required: ['name', 'grams'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, beanId: { type: 'string' }, grams: { type: 'number', exclusiveMinimum: 0 } } } },
    waterG: { type: 'number' },
    ratio: { type: 'string' },
    tempC: { type: 'number' },
    bypass: {
      type: 'object',
      description: 'xBloom 바이패스 물은 5-100ml입니다. BrewDial은 범위 밖 값을 거부합니다. 기기 자체는 100ml 초과 값을 100ml로 제한하지만, 이 API에서는 허용되지 않습니다. 업데이트 시 params 키 하나로 통째로 교체하며 null이면 제거합니다.',
      required: ['waterG'],
      properties: {
        waterG: { type: 'number', minimum: 5, maximum: 100, description: 'xBloom 바이패스 범위는 5-100ml입니다. 범위 밖 값은 BrewDial에서 거부합니다.' },
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
      '새 커피 레시피를 BrewDial에 저장합니다. 기존 원두에 연결하려면 find_bean으로 찾아 beanSnapshot에 정확한 원두명과 로스터를 넣거나 beanId를 전달하세요. 비슷한 레시피가 있어도 생성은 막히지 않으며, 응답의 possibleDuplicateOf에 경고로 표시됩니다. 의도된 변형은 supersede_recipe로 계보를 연결할 수 있습니다. 각 단계에는 atSec, waterG, note와 선택적 endSec, pourRateGPerSec를 지정합니다. xBloom 레시피는 pattern, rpm, vibrationBefore, vibrationAfter, pauseSec, tempC와 params.bypass를 구조화 필드로 전달하세요. 기기는 레시피당 최대 9회 붓기를 지원하고, rpm은 첫 붓기의 값을 전체 추출에 적용합니다. pauseSec는 0-127초이며 바이패스 물은 5-100ml입니다. 범위 밖 값은 BrewDial이 거부하며, 기기 자체는 100ml 초과 값을 100ml로 제한합니다. 이 필드들은 note 태그를 대체합니다. params.grind는 문자열 또는 구조화 객체 { target: { brewMethodPosition, targetDrawdownSec, microns }, perGrinder: [{ grinder, clicks, source: "measured" }], legacyText }입니다. target에는 brewMethodPosition 또는 targetDrawdownSec가 필요하며 microns는 참고값입니다. perGrinder의 그라인더명은 list_grinders 결과와 정확히 일치해야 앱이 다른 그라인더의 클릭 수로 변환할 수 있습니다. 드리퍼 간 이식성은 dripperPortability = { origin: { dripper, sizeModel? }, anchors: { ratio, tempC, targetDrawdownSec } }로 지정하고 origin.dripper는 list_drippers 결과와 정확히 일치시킵니다. 앱은 드리퍼 크기 적합성, 분쇄도/푸어 방향, 40g 이상 도징의 베드 넘침 경고를 조회 시 계산하므로 params.doseG도 지정하세요.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['v60', 'espresso', 'aeropress', 'kalita', 'other'], description: 'Brew method' },
        title: { type: 'string', description: 'Human-readable recipe title' },
        beanId: { type: 'string', description: 'Optional stable bean identifier' },
        parentCode: { type: 'string', description: '선택적 부모 레시피 코드 (COF-NNNN)' },
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
      '기존 레시피를 수정합니다. params는 최상위 키별로 병합되며 전달한 값은 교체되고 null은 제거됩니다. params.bypass는 하나의 키로 통째로 교체됩니다. xBloom 단계의 구조화 필드(pattern, rpm, vibrationBefore, vibrationAfter, pauseSec, tempC)는 note 태그를 대체합니다. 기기는 레시피당 최대 9회 붓기를 지원하고, rpm은 첫 붓기의 값을 전체 추출에 적용합니다. pauseSec는 0-127초이며 바이패스 물은 5-100ml입니다. 범위 밖 값은 BrewDial이 거부하며, 기기 자체는 100ml 초과 값을 100ml로 제한합니다. steps, intent, notes 및 기타 필드는 전체 교체됩니다. expectedVersion으로 동시 변경을 확인하고 dryRun: true로 쓰기 전에 미리 볼 수 있습니다.',
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
    name: 'set_recipe_parent',
    title: 'Set Recipe Parent',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: '기존 레시피의 계보상 부모를 지정하거나 null로 연결을 해제합니다. 콘텐츠 버전은 변경하지 않습니다.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Recipe code, format COF-NNNN' }, parentCode: { type: ['string', 'null'], description: 'Parent recipe code or null to clear' } }, required: ['code', 'parentCode'] }
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
    name: 'list_brews',
    title: '추출 기록 목록',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'xBloom 추출 기록을 최신순으로 조회합니다. brewedAt은 ISO 8601, brewTimeSec와 pourEndSec, drawdownSec는 초, 물은 ml, 컵 무게와 유지량은 g, 초기 드로다운 속도는 g/s입니다. 물의 누적량에는 바이패스 물이 포함됩니다. 이상 징후 정보는 상세 조회에서 확인하며 참고용입니다.',
    inputSchema: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, description: '조회 개수 (기본 20, 최대 100)' },
      recipeCode: { type: 'string', description: '연결된 BrewDial 레시피 코드 COF-NNNN' },
      xbloomRecipeId: { type: 'string', description: 'xBloom 레시피 tableId' },
      since: { type: 'string', description: '이 ISO 8601 시각 이후에 추출한 기록' }
    } }
  },
  {
    name: 'get_brew',
    title: '추출 기록 상세',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'xBloom 추출 기록 하나와 1 Hz 곡선, 저장된 파생 지표, 연결된 레시피, 같은 xBloom 레시피의 이전 기록에 대한 이상 징후 힌트를 조회합니다. brewedAt은 ISO 8601, brewTimeSec와 pourEndSec, drawdownSec는 초, 물은 ml, 컵 무게와 유지량은 g, 초기 드로다운 속도는 g/s입니다. 누적 물에는 바이패스 물이 포함됩니다. 힌트는 참고용입니다. 클라우드 1 Hz 곡선만으로는 필터가 밀린 원인 등을 약하게 구분하므로 unusual은 운영자에게 확인할 단서이지 결론이 아닙니다. 곡선은 기본 최대 60개 점이며 fullCurve=true로 전체를 받을 수 있습니다.',
    inputSchema: { type: 'object', properties: {
      xbloomBrewId: { type: 'string', description: 'xBloom 추출 기록 tableId' },
      fullCurve: { type: 'boolean', description: 'true이면 전체 1 Hz 곡선을 반환합니다. 기본 false는 최대 60개 점으로 줄입니다.' }
    }, required: ['xbloomBrewId'] }
  },
  {
    name: 'link_xbloom_recipe',
    title: 'xBloom 레시피 연결',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'xBloom recipe tableId를 BrewDial 레시피 코드에 연결하거나 기존 연결을 바꿉니다. 연결은 brew read 시점에 적용되므로 저장된 과거 추출 기록에도 즉시 반영됩니다.',
    inputSchema: { type: 'object', properties: {
      xbloomRecipeId: { type: 'string', description: 'xBloom 레시피 tableId' },
      recipeCode: { type: 'string', description: 'BrewDial 레시피 코드 COF-NNNN' }
    }, required: ['xbloomRecipeId', 'recipeCode'] }
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
    name: 'review_recipe',
    title: '레시피 검토',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: '레시피 계보와 각 버전의 변경점, 피드백, 추출 기록을 근거로 반환하고 고정 규칙 검사를 제공합니다. rawComment는 운영자가 직접 쓴 문장이고 comment는 에이전트 요약일 수 있습니다. 다음 변경은 호출자가 판단합니다.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: '레시피 코드 COF-NNNN' } },
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
        actual: {
          type: 'object',
          description: '실제 추출값입니다. doseG, waterG는 양수이고 blend는 최대 5개 원두별 grams를 기록합니다.',
          properties: {
            tempC: { type: 'number' }, grind: { type: 'string' }, timeSec: { type: 'number' },
            doseG: { type: 'number', exclusiveMinimum: 0 }, waterG: { type: 'number', exclusiveMinimum: 0 },
            blend: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', required: ['grams'], anyOf: [{ required: ['beanId'] }, { required: ['name'] }], properties: { beanId: { type: 'string' }, name: { type: 'string' }, grams: { type: 'number', exclusiveMinimum: 0 } }, additionalProperties: false } }
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
    name: 'update_feedback',
    title: 'Update Feedback',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: '저장된 피드백을 수정합니다. ratings와 actual은 키 단위로 병합되고 null인 키는 삭제됩니다. 텍스트와 태그 배열은 전달한 값으로 교체됩니다. expectedUpdatedAt이 오래되면 충돌을 반환하고 dryRun은 저장하지 않고 before/after/changed를 보여줍니다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '피드백 UUID' }, expectedUpdatedAt: { type: 'string' }, dryRun: { type: 'boolean' },
        ratings: {
          type: 'object', additionalProperties: false,
          properties: {
            overall: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
            sweetness: { type: ['integer', 'null'], minimum: 0, maximum: 4 }, burnt: { type: ['integer', 'null'], minimum: 0, maximum: 4 },
            bitter: { type: ['integer', 'null'], minimum: 0, maximum: 4 }, sour: { type: ['integer', 'null'], minimum: 0, maximum: 4 },
            body: { type: ['integer', 'null'], minimum: 0, maximum: 4 }, astringency: { type: ['integer', 'null'], minimum: 0, maximum: 4 },
            clarity: { type: ['integer', 'null'], minimum: 0, maximum: 4 }
          }
        },
        actual: {
          type: 'object', additionalProperties: false,
          description: '실제 추출값을 키별로 병합합니다. 키 값을 null로 보내면 해당 값을 삭제합니다.',
          properties: {
            tempC: { type: ['number', 'null'] }, grind: { type: ['string', 'null'] }, timeSec: { type: ['number', 'null'] },
            doseG: { type: ['number', 'null'], exclusiveMinimum: 0 }, waterG: { type: ['number', 'null'], exclusiveMinimum: 0 },
            blend: { type: ['array', 'null'], minItems: 1, maxItems: 5, items: { type: 'object', required: ['grams'], anyOf: [{ required: ['beanId'] }, { required: ['name'] }], properties: { beanId: { type: 'string' }, name: { type: 'string' }, grams: { type: 'number', exclusiveMinimum: 0 } }, additionalProperties: false } }
          }
        },
        rawComment: { type: ['string', 'null'] }, comment: { type: ['string', 'null'] },
        quickTags: { type: ['array', 'null'], items: { type: 'string' } },
        desiredDirection: { type: ['array', 'null'], items: { type: 'string' } },
        nextHint: { type: ['array', 'null'], items: { type: 'string' } }
      }, required: ['id']
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
        case 'set_recipe_parent': result = await handleSetRecipeParent(api, a); break;
        case 'find_bean': result = await handleFindBean(api, a); break;
        case 'list_beans': result = await handleListBeans(api, a); break;
        case 'update_bean_attributes': result = await handleUpdateBeanAttributes(api, a); break;
        case 'list_grinders': result = await handleListGrinders(api, a); break;
        case 'list_drippers': result = await handleListDrippers(api, a); break;
        case 'get_recent_context': result = await handleGetRecentContext(api, a); break;
        case 'get_recipe_context': result = await handleGetRecipeContext(api, a); break;
        case 'review_recipe': result = await handleReviewRecipe(api, a); break;
        case 'list_brews': result = await handleListBrews(api, a); break;
        case 'get_brew': result = await handleGetBrew(api, a); break;
        case 'link_xbloom_recipe': result = await handleLinkXBloomRecipe(api, a); break;
        case 'create_feedback': result = await handleCreateFeedback(api, a); break;
        case 'update_feedback': result = await handleUpdateFeedback(api, a); break;
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
