import type { RecipeCode, RecipeDoc } from '@brewdial/shared';
import type { FeedbackDoc } from '@brewdial/shared';
import type { McpBrewRow, XBloomRecipeLink } from './repositories/brews.js';

export const RECIPE_REVIEW_LIMITS = {
  ancestors: 20,
  descendants: 50,
  targetTimeGapSec: 10,
  actualTimeGapSec: 5,
  anomalyBrews: 10,
  listBrews: 100,
  maxConcurrentApiRequests: 8,
} as const;

export interface RecipeReviewNodeInput {
  recipe: RecipeDoc;
  feedback: FeedbackDoc[];
  brews: McpBrewRow[];
  brewDetails: McpBrewRow[];
}

export interface RecipeReviewInput {
  code: RecipeCode;
  nodes: RecipeReviewNodeInput[];
  xbloomLinks: XBloomRecipeLink[];
  ancestorsTruncated: boolean;
  descendantsTruncated: boolean;
}

type DiffGroup = 'dose' | 'water' | 'temperature' | 'grind' | 'timing' | 'pattern' | 'equipment' | 'bypass' | 'other';
export interface RecipeDiff { group: DiffGroup; path: string; from: unknown; to: unknown }

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffGroup(path: string): DiffGroup {
  const key = path.replace(/^params\./, '');
  if (key === 'doseG' || key === 'components') return 'dose';
  if (key === 'waterG' || key === 'ratio' || /\.waterG$/.test(key)) return 'water';
  if (key === 'tempC' || /\.tempC$/.test(key)) return 'temperature';
  if (key === 'grind') return 'grind';
  if (key === 'targetTimeSec' || /\.(atSec|endSec|pourRateGPerSec)$/.test(key)) return 'timing';
  if (key === 'brewer' || key === 'grinder') return 'equipment';
  if (key === 'bypass' || key.startsWith('bypass.')) return 'bypass';
  if (/\.(note|pattern)$/.test(key)) return 'pattern';
  return 'other';
}

function makeDiff(parent: RecipeDoc | undefined, recipe: RecipeDoc): RecipeDiff[] {
  if (!parent) return [];
  const diffs: RecipeDiff[] = [];
  const recordChange = (path: string, from: unknown, to: unknown) => {
    if (!same(from, to)) diffs.push({ group: diffGroup(path), path, from: from ?? null, to: to ?? null });
  };
  const paramKeys = new Set([...Object.keys(parent.params ?? {}), ...Object.keys(recipe.params ?? {})]);
  for (const key of [...paramKeys].sort()) recordChange(`params.${key}`, parent.params[key as keyof typeof parent.params], recipe.params[key as keyof typeof recipe.params]);

  const steps = Math.max(parent.steps.length, recipe.steps.length);
  for (let index = 0; index < steps; index += 1) {
    const before = parent.steps[index] as unknown as Record<string, unknown> | undefined;
    const after = recipe.steps[index] as unknown as Record<string, unknown> | undefined;
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    for (const key of [...keys].sort()) recordChange(`steps[${index}].${key}`, before?.[key], after?.[key]);
  }
  return diffs;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function isValidCurve(brew: McpBrewRow): boolean {
  return Array.isArray(brew.curve) && brew.curve.length > 0;
}

function makeBrewSummary(input: RecipeReviewNodeInput) {
  const details = new Map(input.brewDetails.map((brew) => [brew.xbloomBrewId, brew]));
  const detailed = input.brews.map((brew) => details.get(brew.xbloomBrewId) ?? brew);
  const usable = detailed.filter((brew) => brew.brewTimeSec > 0 && isValidCurve(brew));
  const times = usable.map((brew) => brew.brewTimeSec);
  const drawdowns = usable.map((brew) => brew.drawdownSec).filter(Number.isFinite);
  const cups = usable.map((brew) => brew.finalCupG).filter(Number.isFinite);
  const chronological = [...usable].sort((a, b) => a.brewedAt.localeCompare(b.brewedAt));
  return {
    count: input.brews.length,
    medianBrewTimeSec: median(times),
    minBrewTimeSec: times.length ? Math.min(...times) : null,
    maxBrewTimeSec: times.length ? Math.max(...times) : null,
    medianDrawdownSec: median(drawdowns),
    medianFinalCupG: median(cups),
    firstAt: chronological[0]?.brewedAt ?? null,
    lastAt: chronological.at(-1)?.brewedAt ?? null,
    ids: input.brews.map((brew) => brew.xbloomBrewId),
    excludedFromStatistics: {
      zeroBrewTime: detailed.filter((brew) => brew.brewTimeSec === 0).length,
      noCurve: detailed.filter((brew) => !isValidCurve(brew)).length,
    },
    _usable: usable,
    _details: detailed,
  };
}

function asFeedback(feedback: FeedbackDoc[]) {
  return feedback.map((item) => ({
    id: item.id ?? item._id,
    createdAt: item.createdAt,
    ratings: item.ratings ?? null,
    actual: item.actual ?? null,
    rawComment: item.rawComment ?? null,
    source: item.source,
  }));
}

export function buildRecipeReview(input: RecipeReviewInput) {
  const byCode = new Map(input.nodes.map((node) => [node.recipe.code, node]));
  const self = byCode.get(input.code);
  if (!self) return null;

  const ancestorNodes: RecipeReviewNodeInput[] = [];
  const seenAncestors = new Set<RecipeCode>([input.code]);
  let parentCode = self.recipe.parentCode;
  while (parentCode && ancestorNodes.length < RECIPE_REVIEW_LIMITS.ancestors && !seenAncestors.has(parentCode)) {
    seenAncestors.add(parentCode);
    const node = byCode.get(parentCode);
    if (!node) break;
    ancestorNodes.push(node);
    parentCode = node.recipe.parentCode;
  }
  ancestorNodes.reverse();

  const descendants: RecipeReviewNodeInput[] = [];
  const queue: RecipeReviewNodeInput[] = [self];
  const seenDescendants = new Set<RecipeCode>([input.code]);
  let descendantsTruncated = input.descendantsTruncated;
  while (queue.length) {
    const current = queue.shift()!;
    const children = input.nodes.filter((node) => node.recipe.parentCode === current.recipe.code)
      .sort((a, b) => a.recipe.createdAt.localeCompare(b.recipe.createdAt));
    for (const child of children) {
      if (seenDescendants.has(child.recipe.code)) continue;
      if (descendants.length >= RECIPE_REVIEW_LIMITS.descendants) {
        descendantsTruncated = true;
        continue;
      }
      seenDescendants.add(child.recipe.code);
      descendants.push(child);
      queue.push(child);
    }
  }

  const orderedNodes = [...ancestorNodes, self, ...descendants];
  const nodeOutput = orderedNodes.map((node) => {
    const parent = node.recipe.parentCode ? byCode.get(node.recipe.parentCode)?.recipe : undefined;
    const diffFromParent = makeDiff(parent, node.recipe);
    const brewSummary = makeBrewSummary(node);
    return {
      code: node.recipe.code,
      title: node.recipe.title,
      status: node.recipe.status ?? 'active',
      version: node.recipe.version,
      createdAt: node.recipe.createdAt,
      relation: node.recipe.code === input.code ? 'self' as const : seenAncestors.has(node.recipe.code) ? 'ancestor' as const : 'descendant' as const,
      parentCode: node.recipe.parentCode ?? null,
      intent: node.recipe.intent ?? [],
      adjustmentFromPrevious: node.recipe.adjustmentFromPrevious ?? null,
      notes: node.recipe.notes ?? null,
      diffFromParent,
      changedGroups: [...new Set(diffFromParent.map((diff) => diff.group))],
      feedback: { count: node.feedback.length, items: asFeedback(node.feedback), overall: node.feedback.map((item) => item.ratings?.overall ?? null) },
      brews: {
        count: brewSummary.count,
        medianBrewTimeSec: brewSummary.medianBrewTimeSec,
        minBrewTimeSec: brewSummary.minBrewTimeSec,
        maxBrewTimeSec: brewSummary.maxBrewTimeSec,
        medianDrawdownSec: brewSummary.medianDrawdownSec,
        medianFinalCupG: brewSummary.medianFinalCupG,
        firstAt: brewSummary.firstAt,
        lastAt: brewSummary.lastAt,
        ids: brewSummary.ids,
        excludedFromStatistics: brewSummary.excludedFromStatistics,
      },
      _source: node,
      _usableBrews: brewSummary._usable,
      _detailedBrews: brewSummary._details,
    };
  });

  const checks: Array<{ id: string; severity: 'info' | 'warn'; message: string; evidence: { recipeCodes?: string[]; feedbackIds?: string[]; brewIds?: string[] } }> = [];
  const addCheck = (id: string, severity: 'info' | 'warn', message: string, evidence: { recipeCodes?: string[]; feedbackIds?: string[]; brewIds?: string[] }) => checks.push({ id, severity, message, evidence });
  for (const node of nodeOutput) {
    const recipe = node._source.recipe;
    const validBrews = node._usableBrews as McpBrewRow[];
    const feedbacks = node._source.feedback;
    if (validBrews.length >= 2 && typeof recipe.params.targetTimeSec === 'number' && node.brews.medianBrewTimeSec !== null && Math.abs(recipe.params.targetTimeSec - node.brews.medianBrewTimeSec) > RECIPE_REVIEW_LIMITS.targetTimeGapSec) {
      addCheck('target_time_gap', 'warn', `${recipe.code}: 목표 추출 시간과 기기 기록 중앙값의 차이가 ${RECIPE_REVIEW_LIMITS.targetTimeGapSec}초를 넘습니다.`, { recipeCodes: [recipe.code], brewIds: validBrews.map((brew) => brew.xbloomBrewId) });
    }
    const unscored = feedbacks.filter((item) => item.ratings?.overall == null);
    if (unscored.length) addCheck('feedback_without_overall', 'info', `${recipe.code}: overall 점수가 없는 피드백이 ${unscored.length}개 있습니다.`, { recipeCodes: [recipe.code], feedbackIds: unscored.map((item) => item.id ?? item._id) });
    for (const feedback of feedbacks) {
      if (typeof feedback.actual?.timeSec === 'number' && node.brews.medianBrewTimeSec !== null && Math.abs(feedback.actual.timeSec - node.brews.medianBrewTimeSec) > RECIPE_REVIEW_LIMITS.actualTimeGapSec) {
        addCheck('feedback_actual_vs_machine', 'warn', `${recipe.code}: 피드백의 실제 시간과 기기 기록 중앙값의 차이가 ${RECIPE_REVIEW_LIMITS.actualTimeGapSec}초를 넘습니다.`, { recipeCodes: [recipe.code], feedbackIds: [feedback.id ?? feedback._id], brewIds: validBrews.map((brew) => brew.xbloomBrewId) });
      }
    }
    if (node.relation !== 'self' && node.changedGroups.length > 1) {
      const timingOnlyFollowsWater = node.changedGroups.includes('water') && node.changedGroups.includes('timing') && (node.diffFromParent as RecipeDiff[]).filter((diff) => diff.group === 'timing').every((diff) => /^steps\[\d+\]\.endSec$/.test(diff.path) && (node.diffFromParent as RecipeDiff[]).some((water) => water.group === 'water' && water.path.replace(/\.waterG$/, '') === diff.path.replace(/\.endSec$/, '')));
      const groups = (node.changedGroups as DiffGroup[]).filter((group) => !(group === 'timing' && timingOnlyFollowsWater));
      if (groups.length > 1) addCheck('multi_variable_change', 'warn', `${recipe.code}: 이전 버전에서 ${groups.length}개 조정 그룹(${groups.join(', ')})이 바뀌었습니다.${timingOnlyFollowsWater ? ' 물 조정에 따른 endSec 변화는 timing 그룹에서 제외했습니다.' : ''}`, { recipeCodes: [recipe.parentCode!, recipe.code] });
    }
    const newestFeedbackAt = feedbacks.reduce<string | null>((latest, item) => !latest || item.createdAt > latest ? item.createdAt : latest, null);
    const newerBrews = node._detailedBrews.filter((brew) => !newestFeedbackAt || brew.brewedAt > newestFeedbackAt);
    if (newerBrews.length) addCheck('brews_without_feedback', 'info', `${recipe.code}: 가장 최근 피드백 이후의 기기 추출 기록이 ${newerBrews.length}개 있습니다.`, { recipeCodes: [recipe.code], brewIds: newerBrews.map((brew) => brew.xbloomBrewId) });
    if (!feedbacks.length && !node.brews.count) addCheck('untried_version', 'info', `${recipe.code}: 피드백과 추출 기록이 없습니다.`, { recipeCodes: [recipe.code] });
    const usesXBloom = [recipe.params.grinder, recipe.params.brewer].some((value) => typeof value === 'string' && /xbloom/i.test(value));
    if (usesXBloom && !input.xbloomLinks.some((link) => link.recipeCode === recipe.code)) addCheck('no_xbloom_link', 'info', `${recipe.code}: xBloom 장비 이름이 있지만 연결된 xBloom 레시피가 없습니다.`, { recipeCodes: [recipe.code] });
  }
  const newestSelfBrews = [...(self.brews ?? [])].sort((a, b) => b.brewedAt.localeCompare(a.brewedAt)).slice(0, RECIPE_REVIEW_LIMITS.anomalyBrews);
  const anomalous = newestSelfBrews.map((brew) => self.brewDetails.find((detail) => detail.xbloomBrewId === brew.xbloomBrewId) ?? brew)
    .filter((brew) => typeof brew.anomalyHint === 'object' && brew.anomalyHint !== null && 'status' in brew.anomalyHint && brew.anomalyHint.status !== 'normal');
  if (anomalous.length) addCheck('anomaly_flagged', 'warn', `기준 레시피의 최신 추출 기록 ${RECIPE_REVIEW_LIMITS.anomalyBrews}개 중 anomalyHint.status가 normal이 아닌 기록이 ${anomalous.length}개 있습니다.`, { recipeCodes: [input.code], brewIds: anomalous.map((brew) => brew.xbloomBrewId) });

  return {
    lineage: {
      nodes: nodeOutput.map(({ code, title, status, version, createdAt, relation, parentCode }) => ({ code, title, status, version, createdAt, relation, parentCode })),
      truncated: { ancestors: input.ancestorsTruncated, descendants: descendantsTruncated },
    },
    recipes: nodeOutput.map(({ _source: _s, _usableBrews: _u, _detailedBrews: _d, ...node }) => node),
    checks,
  };
}
