import { describe, expect, it } from 'vitest';
import type { ApiConfig } from './config.js';
import { fetchRecipeReview } from './recipe-review-context.js';
import { RECIPE_REVIEW_LIMITS } from './recipe-review.js';

describe('fetchRecipeReview', () => {
  it('bounds concurrency across lineage, feedback, brew-list, and brew-detail reads', async () => {
    let active = 0;
    let maxActive = 0;
    const brewIds = Array.from({ length: 24 }, (_, index) => `fixture-${String(index).padStart(2, '0')}`);
    const recipeRow = {
      id: 'recipe:COF-4101', code: 'COF-4101', method: 'v60', title: 'Concurrency fixture', version: 1,
      params: {}, steps: [], bean_id: null, bean_snapshot: null, intent: null, notes: null,
      adjustment_from_previous: null, created_by: 'agent', status: 'active', supersedes: null,
      superseded_by: null, parent_code: null, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z'
    };
    const fetchImpl = (async (input: string | URL | Request) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      const url = String(input);
      let body: unknown;
      if (url.endsWith('/api/agent/recipes/COF-4101')) body = recipeRow;
      else if (url.includes('/api/agent/recipes?parentCode=')) body = [];
      else if (url.endsWith('/api/agent/xbloom-recipe-links')) body = [];
      else if (url.endsWith('/api/recipes/COF-4101/feedback')) body = [];
      else if (url.includes('/api/agent/brews?')) body = brewIds.map((xbloomBrewId, index) => ({
        xbloomBrewId, brewedAt: `2026-11-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, brewTimeSec: 200,
        recipeName: 'Concurrency fixture', xbloomRecipeId: '7001', totalWaterMl: 250, finalCupG: 220,
        retentionG: 30, pourEndSec: 150, cupAtPourEndG: 200, drawdownSec: 50, earlyDrawdownGPerSec: 1,
      }));
      else if (url.includes('/api/agent/brews/')) body = {
        xbloomBrewId: url.slice(url.lastIndexOf('/') + 1), brewedAt: '2026-11-01T00:00:00.000Z', brewTimeSec: 200,
        recipeName: 'Concurrency fixture', xbloomRecipeId: '7001', totalWaterMl: 250, finalCupG: 220,
        retentionG: 30, pourEndSec: 150, cupAtPourEndG: 200, drawdownSec: 50, earlyDrawdownGPerSec: 1,
        curve: [[0, 0], [200, 220]], anomalyHint: { status: 'normal' },
      };
      else throw new Error(`Unexpected fixture request: ${url}`);
      active -= 1;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const config: ApiConfig = { baseUrl: 'https://brewdial-review.example', agentToken: 'fixture-token', fetchImpl };

    const review = await fetchRecipeReview(config, 'COF-4101' as `COF-${string}`);
    expect(review?.recipes[0]?.brews.count).toBe(24);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(RECIPE_REVIEW_LIMITS.maxConcurrentApiRequests);
  });
});
