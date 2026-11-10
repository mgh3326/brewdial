import { describe, expect, it } from 'vitest';
import type { RecipeDoc, RecipeCode, RecipeStep, RecipeParams } from '@brewdial/shared';
import type { FeedbackDoc } from '@brewdial/shared';
import type { McpBrewRow } from './repositories/brews.js';
import { buildRecipeReview, RECIPE_REVIEW_LIMITS, type RecipeReviewInput, type RecipeReviewNodeInput } from './recipe-review.js';

const stamp = (day: number) => `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`;

function recipe(code: number, parent: number | null, params: RecipeParams = {}, steps: RecipeStep[] = []): RecipeDoc {
  return {
    _id: `recipe:COF-${String(code).padStart(4, '0')}`,
    type: 'recipe',
    code: `COF-${String(code).padStart(4, '0')}` as RecipeCode,
    method: 'v60',
    version: code,
    title: `Synthetic ${code}`,
    params,
    steps,
    createdBy: 'agent',
    status: 'active',
    createdAt: stamp(code),
    updatedAt: stamp(code),
    ...(parent === null ? {} : { parentCode: `COF-${String(parent).padStart(4, '0')}` as RecipeCode }),
  };
}

function feedback(id: string, day: number, overall?: number, timeSec?: number): FeedbackDoc {
  return {
    id,
    _id: `feedback:${id}`,
    type: 'feedback',
    recipeCode: 'COF-0003' as RecipeCode,
    recipeId: 'recipe:COF-0003',
    source: 'mcp',
    createdAt: stamp(day),
    updatedAt: stamp(day),
    rawComment: 'The cup was bright.  Keep these exact words.',
    ...(overall === undefined ? {} : { ratings: { overall: overall as 1 | 2 | 3 | 4 | 5 } }),
    ...(timeSec === undefined ? {} : { actual: { timeSec } }),
  };
}

function brew(id: string, day: number, time: number, extra: Record<string, unknown> = {}): McpBrewRow {
  return {
    xbloomBrewId: id,
    brewedAt: stamp(day),
    brewTimeSec: time,
    recipeName: 'Synthetic brew',
    xbloomRecipeId: '7001',
    totalWaterMl: 250,
    finalCupG: 220,
    retentionG: 30,
    pourEndSec: 150,
    cupAtPourEndG: 200,
    drawdownSec: time - 150,
    earlyDrawdownGPerSec: 1,
    curve: [[0, 0], [time, 220]],
    ...extra,
  } as McpBrewRow;
}

function node(recipeDoc: RecipeDoc, feedbackRows: FeedbackDoc[] = [], brews: McpBrewRow[] = [], brewDetails: McpBrewRow[] = []): RecipeReviewNodeInput {
  return { recipe: recipeDoc, feedback: feedbackRows, brews, brewDetails };
}

describe('buildRecipeReview', () => {
  it('fires fixed checks on a synthetic five-version chain and preserves raw evidence', () => {
    const base = recipe(1, null, {
      doseG: 18, components: [{ name: 'Blend A', grams: 18 }], waterG: 270, ratio: '1:15', tempC: 92,
      grind: 'medium', grinder: 'Hand grinder', brewer: 'V60', targetTimeSec: 180,
      bypass: { waterG: 10, tempC: 80 },
    }, [{ atSec: 0, endSec: 30, waterG: 40, tempC: 92, pourRateGPerSec: 2, pattern: 'center', note: 'center pour', rpm: 5 }]);
    const v2 = recipe(2, 1, {
      doseG: 19, components: [{ name: 'Blend B', grams: 19 }], waterG: 280, ratio: '1:14.7', tempC: 94,
      grind: 'fine', grinder: 'xBloom Grinder', brewer: 'xBloom Dripper', targetTimeSec: 180,
      bypass: { waterG: 15, tempC: 82 },
    }, [{ atSec: 0, endSec: 35, waterG: 50, tempC: 94, pourRateGPerSec: 3, pattern: 'spiral', note: 'spiral pour', rpm: 8, vibrationBefore: true }]);
    const self = recipe(3, 2, { ...v2.params, targetTimeSec: 200 });
    const child = recipe(4, 3, { ...self.params, doseG: 20, tempC: 96 });
    const untried = recipe(5, 4, { ...child.params });
    const selfFeedback = feedback('fb-self', 9, undefined, 222);
    const summaries = [brew('brew-good-1', 8, 220), brew('brew-good-2', 10, 240), brew('brew-broken', 7, 0, { curve: [] })];
    const details = [
      brew('brew-good-1', 8, 220, { anomalyHint: { status: 'normal' } }),
      brew('brew-good-2', 10, 240, { anomalyHint: { status: 'high_drawdown' } }),
      brew('brew-broken', 7, 0, { curve: [], anomalyHint: { status: 'normal' } }),
    ];
    const input: RecipeReviewInput = {
      code: self.code,
      nodes: [node(base), node(v2), node(self, [selfFeedback], summaries, details), node(child), node(untried)],
      xbloomLinks: [], ancestorsTruncated: false, descendantsTruncated: false,
    };
    const review = buildRecipeReview(input)!;

    expect(review.lineage.nodes.map((item) => item.code)).toEqual(['COF-0001', 'COF-0002', 'COF-0003', 'COF-0004', 'COF-0005']);
    expect(review.lineage.nodes.map((item) => item.relation)).toEqual(['ancestor', 'ancestor', 'self', 'descendant', 'descendant']);
    expect(review.recipes[1]!.changedGroups).toEqual(expect.arrayContaining(['dose', 'water', 'temperature', 'grind', 'timing', 'pattern', 'equipment', 'bypass', 'other']));
    expect(review.recipes[1]!.diffFromParent).toContainEqual({ group: 'dose', path: 'params.components', from: [{ name: 'Blend A', grams: 18 }], to: [{ name: 'Blend B', grams: 19 }] });
    expect(review.recipes[2]!.notes).toBeNull();
    expect(review.recipes[2]!.feedback.items[0]!.rawComment).toBe('The cup was bright.  Keep these exact words.');
    expect(review.recipes[2]!.brews).toMatchObject({ count: 3, medianBrewTimeSec: 230, minBrewTimeSec: 220, maxBrewTimeSec: 240, excludedFromStatistics: { zeroBrewTime: 1, noCurve: 1 } });
    expect(review.recipes[2]!.brews.ids).toEqual(['brew-good-1', 'brew-good-2', 'brew-broken']);
    expect(review.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
      'target_time_gap', 'feedback_without_overall', 'feedback_actual_vs_machine', 'multi_variable_change',
      'brews_without_feedback', 'untried_version', 'no_xbloom_link', 'anomaly_flagged',
    ]));
    expect(review.checks.find((check) => check.id === 'target_time_gap')!.evidence.brewIds).toEqual(['brew-good-1', 'brew-good-2']);
    expect(review.checks.find((check) => check.id === 'anomaly_flagged')!.evidence.brewIds).toEqual(['brew-good-2']);
  });

  it('keeps checks quiet when evidence is within every threshold', () => {
    const parent = recipe(10, null, { doseG: 18, targetTimeSec: 200 });
    const self = recipe(11, 10, { doseG: 19, targetTimeSec: 200 });
    const parentBrew = brew('brew-parent', 8, 200, { anomalyHint: { status: 'normal' } });
    const recorded = brew('brew-matching', 8, 205, { anomalyHint: { status: 'normal' } });
    const rated = { ...feedback('fb-rated', 9, 4, 204), recipeCode: self.code, recipeId: `recipe:${self.code}` };
    const parentRated = { ...feedback('fb-parent', 9, 4, 200), recipeCode: parent.code, recipeId: `recipe:${parent.code}` };
    const review = buildRecipeReview({
      code: self.code,
      nodes: [node(parent, [parentRated], [parentBrew], [parentBrew]), node(self, [rated], [recorded], [recorded])],
      xbloomLinks: [], ancestorsTruncated: false, descendantsTruncated: false,
    })!;
    expect(review.checks).toEqual([]);
  });

  it('reports both lineage caps and excludes broken brews from every statistic', () => {
    const chain: RecipeReviewNodeInput[] = [];
    for (let n = 1; n <= 72; n += 1) chain.push(node(recipe(n, n === 1 ? null : n - 1)));
    const review = buildRecipeReview({
      code: 'COF-0022' as RecipeCode,
      nodes: chain,
      xbloomLinks: [],
      ancestorsTruncated: true,
      descendantsTruncated: true,
    })!;
    expect(review.lineage.nodes.filter((item) => item.relation === 'ancestor')).toHaveLength(RECIPE_REVIEW_LIMITS.ancestors);
    expect(review.lineage.nodes.filter((item) => item.relation === 'descendant')).toHaveLength(RECIPE_REVIEW_LIMITS.descendants);
    expect(review.lineage.truncated).toEqual({ ancestors: true, descendants: true });

    const broken = brew('broken', 1, 0, { curve: [], drawdownSec: 100, finalCupG: 300 });
    const single = buildRecipeReview({
      code: 'COF-0090' as RecipeCode,
      nodes: [node(recipe(90, null), [], [broken], [broken])],
      xbloomLinks: [], ancestorsTruncated: false, descendantsTruncated: false,
    })!;
    expect(single.recipes[0]!.brews).toMatchObject({ medianBrewTimeSec: null, medianDrawdownSec: null, medianFinalCupG: null, firstAt: null, lastAt: null, excludedFromStatistics: { zeroBrewTime: 1, noCurve: 1 } });
  });
});
