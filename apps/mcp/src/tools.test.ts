import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleArchiveRecipe,
  handleCreateFeedback,
  handleUpdateFeedback,
  handleCreateRecipe,
  handleFindBean,
  handleGetRecentContext,
  handleGetRecipeContext,
  handleListBeans,
  handleListDrippers,
  handleListGrinders,
  handleSupersedeRecipe,
  handleUpdatePreferences,
  handleUpdateRecipe,
  handleListBrews,
  handleGetBrew,
  handleLinkXBloomRecipe
} from './tools.js';
import type { ApiConfig } from './config.js';

// Inject a mock fetchImpl that always rejects, so tests exercise error paths
// without any real network I/O (no DNS lookups, no flakiness on CI).
const mockConfig: ApiConfig = {
  baseUrl: 'https://brewdial-mcp-test.example',
  agentToken: 'test-agent-token',
};

// Stub global fetch before each test so repo functions that fall back to the
// global fetch also get the mock (handlers don't yet thread fetchImpl through,
// so we mock at the boundary where network I/O would occur).
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network connection refused (mock)')));
});

// A stored feedback row as the agent endpoint returns it (snake_case columns).
function feedbackRowResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: 1,
      recipe_code: 'COF-0001',
      bean_id: null,
      ratings: null,
      actual: null,
      quick_tags: null,
      desired_direction: null,
      next_hint: null,
      source: 'agent',
      created_at: '2026-11-09T00:00:00.000Z',
      updated_at: '2026-11-09T00:00:00.000Z',
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleCreateRecipe', () => {
  it('returns validation details for invalid recipe input', async () => {
    const result = await handleCreateRecipe(mockConfig, { title: 'Missing method' });
    expect(result.content[0].text).toContain('Invalid recipe input');
    expect(result.content[0].text).toContain('method must be one of');
  });

  it('errors when API is unreachable but input is valid', async () => {
    const result = await handleCreateRecipe(mockConfig, { method: 'v60', title: 'Unreachable test recipe' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error creating recipe');
  });
});

describe('handleUpdateRecipe', () => {
  it('rejects invalid recipe code', async () => {
    const r = await handleUpdateRecipe(mockConfig, { code: 'INVALID', title: 'x' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Invalid recipe code');
  });

  it('rejects when no updatable fields are provided', async () => {
    const r = await handleUpdateRecipe(mockConfig, { code: 'COF-0001' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('No updatable fields');
  });

  describe('merge, expectedVersion and dryRun', () => {
    const jsonResponse = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const recipeRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      id: 'r1',
      code: 'COF-0001',
      method: 'v60',
      title: 'Test',
      version: 2,
      params: { tempC: 92 },
      steps: [],
      bean_id: null,
      bean_snapshot: null,
      intent: null,
      notes: null,
      adjustment_from_previous: null,
      created_by: 'agent',
      owner_id: null,
      is_official: false,
      dripper_portability: null,
      status: 'active',
      supersedes: null,
      superseded_by: null,
      parent_code: null,
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
      ...overrides,
    });

    it('sends expectedVersion and null param keys (removals) in the PATCH body', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, recipeRow({ version: 3 })));
      vi.stubGlobal('fetch', fetchMock);
      const r = await handleUpdateRecipe(mockConfig, {
        code: 'COF-0001',
        params: { tempC: 88, grinder: null },
        expectedVersion: 2,
      });
      expect(r.isError).toBeFalsy();
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ params: { tempC: 88, grinder: null }, expectedVersion: 2 });
    });

    it('returns the dry-run before/after/changed payload', async () => {
      const before = recipeRow({ params: { tempC: 92, grinder: 'Comandante' } });
      const after = recipeRow({ params: { tempC: 88, grinder: 'Comandante' } });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { dryRun: true, before, after, changed: ['params.tempC'] }))
      );
      const r = await handleUpdateRecipe(mockConfig, { code: 'COF-0001', params: { tempC: 88 }, dryRun: true });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.content[0].text);
      expect(out).toMatchObject({
        ok: true,
        dryRun: true,
        changed: ['params.tempC'],
        before: { version: 2, params: { tempC: 92, grinder: 'Comandante' } },
        after: { version: 2, params: { tempC: 88, grinder: 'Comandante' } },
      });
    });

    it('reports a version conflict with the current version and no success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { error: 'version_conflict', currentVersion: 5 })));
      const r = await handleUpdateRecipe(mockConfig, { code: 'COF-0001', title: 'x', expectedVersion: 4 });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('version conflict');
      expect(r.content[0].text).toContain('at version 5');
      expect(r.content[0].text).toContain('expectedVersion 5');
    });

    it('rejects a non-integer expectedVersion before calling the API', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const r = await handleUpdateRecipe(mockConfig, { code: 'COF-0001', title: 'x', expectedVersion: 1.5 });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('expectedVersion must be an integer >= 1');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a call that carries only controls (no field to change)', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const r = await handleUpdateRecipe(mockConfig, { code: 'COF-0001', dryRun: true });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('No updatable fields');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('handleArchiveRecipe', () => {
  it('rejects invalid recipe code', async () => {
    const r = await handleArchiveRecipe(mockConfig, { code: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Invalid recipe code');
  });

  it('rejects an invalid status', async () => {
    const r = await handleArchiveRecipe(mockConfig, { code: 'COF-0001', status: 'deleted' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Invalid status');
  });
});

describe('handleSupersedeRecipe', () => {
  it('rejects invalid oldCode', async () => {
    const r = await handleSupersedeRecipe(mockConfig, { oldCode: 'x', newCode: 'COF-0002' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Invalid oldCode');
  });

  it('rejects invalid newCode', async () => {
    const r = await handleSupersedeRecipe(mockConfig, { oldCode: 'COF-0001', newCode: 'x' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Invalid newCode');
  });
});

describe('handleFindBean', () => {
  it('rejects an empty query', async () => {
    const r = await handleFindBean(mockConfig, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('query');
  });

  it('errors when API is unreachable but query is valid', async () => {
    const r = await handleFindBean(mockConfig, { query: '브릴리' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error finding beans');
  });
});

describe('handleListBeans', () => {
  it('errors when API is unreachable', async () => {
    const r = await handleListBeans(mockConfig, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error listing beans');
  });
});

describe('handleListGrinders', () => {
  it('errors when API is unreachable', async () => {
    const r = await handleListGrinders(mockConfig, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error listing grinders');
  });
});

describe('handleListDrippers', () => {
  it('errors when API is unreachable', async () => {
    const r = await handleListDrippers(mockConfig, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error listing drippers');
  });
});

describe('handleGetRecentContext', () => {
  it('returns error when backend is unreachable', async () => {
    const result = await handleGetRecentContext(mockConfig, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });

  it('accepts a limit parameter (still returns content)', async () => {
    const result = await handleGetRecentContext(mockConfig, { limit: 3 });
    expect(result).toHaveProperty('content');
  });
});

describe('handleCreateFeedback', () => {
  it('rejects invalid recipe code', async () => {
    const r = await handleCreateFeedback(mockConfig, { recipeCode: 'INVALID', rawComment: 'x' });
    expect(r.content[0].text).toContain('Invalid feedback input');
  });

  it('rejects empty submissions (no rawComment, ratings, or quickTags)', async () => {
    const r = await handleCreateFeedback(mockConfig, { recipeCode: 'COF-0001' });
    expect(r.content[0].text).toContain('at least one');
  });

  it('errors when API is unreachable but input is valid', async () => {
    const r = await handleCreateFeedback(mockConfig, { recipeCode: 'COF-0001', rawComment: '오늘은 산미가 강했음' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error creating feedback');
  });

  it('returns rawComment null and comment under its own name when only comment is stored', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(feedbackRowResponse({ comment: 'agent summary', raw_comment: null })));

    const r = await handleCreateFeedback(mockConfig, { recipeCode: 'COF-0001', ratings: { overall: 4 } });
    const body = JSON.parse(r.content[0].text);
    expect(body.feedback.rawComment).toBeNull();
    expect(body.feedback.comment).toBe('agent summary');
  });

  it('returns rawComment and comment unchanged when both are stored', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(feedbackRowResponse({ comment: 'agent summary', raw_comment: '산미가 강했음' })));

    const r = await handleCreateFeedback(mockConfig, { recipeCode: 'COF-0001', rawComment: '산미가 강했음' });
    const body = JSON.parse(r.content[0].text);
    expect(body.feedback.rawComment).toBe('산미가 강했음');
    expect(body.feedback.comment).toBe('agent summary');
  });

  it('accepts and forwards actual dose, water, and blend details', async () => {
    const actual = { doseG: 18, waterG: 280, blend: [{ name: 'Ethiopia', grams: 18 }] };
    const fetchMock = vi.fn().mockResolvedValue(feedbackRowResponse({ actual, raw_comment: 'note' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await handleCreateFeedback(mockConfig, { recipeCode: 'COF-0001', rawComment: 'note', actual });
    expect(r.isError).not.toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).actual).toEqual(actual);
  });
});

describe('handleUpdateFeedback', () => {
  const feedbackId = 'd9428888-19fc-4f5a-a1d2-4db03e782009';
  it('validates updates and forwards merge controls', async () => {
    const r = await handleUpdateFeedback(mockConfig, { id: feedbackId, actual: { doseG: null, waterG: 300 }, ratings: { overall: null, sweetness: 3 }, dryRun: true });
    expect(r.content[0].text).toContain('Error updating feedback');
    expect(r.content[0].text).not.toContain('Invalid feedback update');

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ dryRun: true, before: {}, after: {}, changed: ['actual'] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await handleUpdateFeedback(mockConfig, { id: feedbackId, actual: { waterG: 300 }, dryRun: true });
    expect(JSON.parse(ok.content[0].text)).toMatchObject({ ok: true, dryRun: true, changed: ['actual'] });
    expect(fetchMock.mock.calls[0][0]).toContain(`/api/agent/feedback/${feedbackId}`);
  });

  it('returns stale update conflicts from the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'version_conflict', currentUpdatedAt: '2026-11-09T00:00:00.000Z' }), { status: 409 })));
    const r = await handleUpdateFeedback(mockConfig, { id: feedbackId, expectedUpdatedAt: '2020-01-01T00:00:00.000Z', rawComment: 'later' });
    expect(JSON.parse(r.content[0].text)).toMatchObject({ error: 'version_conflict', currentUpdatedAt: '2026-11-09T00:00:00.000Z' });
  });
});

describe('feedback recipe version context', () => {
  it('returns version status in both contexts and the snapshot only in recipe context', async () => {
    const recipe = {
      id: 'recipe-id', code: 'COF-0001', method: 'v60', title: 'Test', version: 2, params: {}, steps: [],
      bean_id: null, bean_snapshot: null, intent: null, notes: null, adjustment_from_previous: null, created_by: 'agent',
      status: 'active', supersedes: null, superseded_by: null, parent_code: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z'
    };
    const snapshot = { params: { doseG: 18 }, steps: [], method: 'v60', beanId: 'bean-1' };
    const feedback = [{
      id: 'feedback-1', recipe_code: 'COF-0001', bean_id: 'bean-1', ratings: { overall: 4 }, actual: null,
      comment: null, raw_comment: 'good', quick_tags: null, desired_direction: null, next_hint: null,
      source: 'mcp', created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
      recipe_version: 1, recipe_snapshot: snapshot, recipe_current_version: 2,
      recipeVersion: 1, recipeSnapshot: snapshot, onCurrentVersion: false
    }];
    const recentBrew = { xbloomBrewId: '123', brewedAt: '2026-01-01T00:00:00.000Z', brewTimeSec: 180, recipeName: 'Fixture', totalWaterMl: 220, finalCupG: 200, retentionG: 20, pourEndSec: 10, cupAtPourEndG: 120, drawdownSec: 20, earlyDrawdownGPerSec: 2 };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      const body = path.includes('/feedback') ? feedback : path.includes('/preferences') ? null : path.includes('/api/agent/brews') ? [recentBrew] : path.includes('/api/recipes?') ? [recipe] : recipe;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const config = { ...mockConfig, fetchImpl };
    const recipeContext = JSON.parse((await handleGetRecipeContext(config, { code: 'COF-0001' })).content[0].text);
    expect(recipeContext.feedback[0]).toMatchObject({ recipeVersion: 1, onCurrentVersion: false, recipeSnapshot: snapshot });
    expect(recipeContext.recentBrews).toEqual([recentBrew]);
    expect(recipeContext.recentBrews[0]).not.toHaveProperty('curve');
    const recent = JSON.parse((await handleGetRecentContext(config, { limit: 1 })).content[0].text);
    expect(recent.recentRecipes[0].feedback[0]).toMatchObject({ recipeVersion: 1, onCurrentVersion: false });
    expect(recent.recentRecipes[0].feedback[0]).not.toHaveProperty('recipeSnapshot');
  });
});

describe('xBloom brew tools', () => {
  it('lists filtered brew summaries through the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    const config = { ...mockConfig, fetchImpl: fetchMock as unknown as typeof fetch };
    const result = await handleListBrews(config, { limit: 5, recipeCode: 'COF-0001', xbloomRecipeId: '42', since: '2026-01-01T00:00:00.000Z' });
    expect(result.isError).toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/agent/brews?limit=5&recipeCode=COF-0001&xbloomRecipeId=42&since=2026-01-01T00%3A00%3A00.000Z');
  });

  it('downsamples get_brew curves to 60 points unless fullCurve is true', async () => {
    const curve = Array.from({ length: 120 }, (_, index) => [index * 2, index] as [number, number]);
    const fetchMock = vi.fn().mockImplementation(() => new Response(JSON.stringify({ xbloomBrewId: '42', curve, anomalyHint: { status: 'unusual', advisory: true } }), { status: 200 }));
    const config = { ...mockConfig, fetchImpl: fetchMock as unknown as typeof fetch };
    const partial = JSON.parse((await handleGetBrew(config, { xbloomBrewId: '42' })).content[0].text);
    expect(partial.curve).toHaveLength(60);
    expect(partial.curve[0]).toEqual(curve[0]);
    expect(partial.curve[59]).toEqual(curve[119]);
    const full = JSON.parse((await handleGetBrew(config, { xbloomBrewId: '42', fullCurve: true })).content[0].text);
    expect(full.curve).toHaveLength(120);
    expect(full.anomalyHint).toMatchObject({ status: 'unusual', advisory: true });
  });

  it('sets an xBloom recipe link with PUT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ xbloomRecipeId: '42', recipeCode: 'COF-0001' }), { status: 200 }));
    const config = { ...mockConfig, fetchImpl: fetchMock as unknown as typeof fetch };
    const result = await handleLinkXBloomRecipe(config, { xbloomRecipeId: '42', recipeCode: 'COF-0001' });
    expect(result.isError).toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/agent/xbloom-recipe-links/42');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ recipeCode: 'COF-0001' });
  });
});

describe('handleUpdatePreferences', () => {
  it('rejects taste tags outside the shared whitelist', async () => {
    const result = await handleUpdatePreferences(mockConfig, { likes: ['초코비'] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('unknown taste tag');
  });

  it('POSTs valid preferences to the agent endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ likes: ['저산미'], dislikes: ['고산미'] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleUpdatePreferences(mockConfig, {
      likes: ['저산미'],
      dislikes: ['고산미'],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('preference:global');
    expect(fetchMock).toHaveBeenCalledWith(
      `${mockConfig.baseUrl}/api/agent/preferences/global`,
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe(`Bearer ${mockConfig.agentToken}`);
    expect(JSON.parse(init.body as string)).toEqual({ likes: ['저산미'], dislikes: ['고산미'] });
  });
});

describe('handleGetRecipeContext', () => {
  it('returns error for invalid recipe code', async () => {
    const result = await handleGetRecipeContext(mockConfig, { code: 'INVALID' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid recipe code');
  });

  it('returns error for non-string code', async () => {
    const result = await handleGetRecipeContext(mockConfig, { code: 123 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid recipe code');
  });

  it('handles missing args', async () => {
    const result = await handleGetRecipeContext(mockConfig, undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid recipe code');
  });
});
