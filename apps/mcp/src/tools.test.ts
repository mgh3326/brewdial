import { describe, it, expect } from 'vitest';
import {
  handleArchiveRecipe,
  handleCreateFeedback,
  handleCreateRecipe,
  handleFindBean,
  handleGetRecentContext,
  handleGetRecipeContext,
  handleListBeans,
  handleSupersedeRecipe,
  handleUpdateRecipe
} from './tools.js';
import type { SupabaseConfig } from './config.js';

// Unreachable host: network calls fail fast (DNS), so handlers exercise their
// error paths without a live Supabase.
const mockConfig: SupabaseConfig = {
  url: 'https://brewdial-mcp-test.invalid',
  serviceRoleKey: 'test-service-role-key'
};

describe('handleCreateRecipe', () => {
  it('returns validation details for invalid recipe input', async () => {
    const result = await handleCreateRecipe(mockConfig, { title: 'Missing method' });
    expect(result.content[0].text).toContain('Invalid recipe input');
    expect(result.content[0].text).toContain('method must be one of');
  });

  it('errors when Supabase is unreachable but input is valid', async () => {
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

  it('errors when Supabase is unreachable but query is valid', async () => {
    const r = await handleFindBean(mockConfig, { query: '브릴리' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error finding beans');
  });
});

describe('handleListBeans', () => {
  it('errors when Supabase is unreachable', async () => {
    const r = await handleListBeans(mockConfig, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error listing beans');
  });
});

describe('handleGetRecentContext', () => {
  it('returns error when Supabase is unreachable', async () => {
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

  it('errors when Supabase is unreachable but input is valid', async () => {
    const r = await handleCreateFeedback(mockConfig, { recipeCode: 'COF-0001', rawComment: '오늘은 산미가 강했음' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error creating feedback');
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
