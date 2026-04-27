import { describe, it, expect } from 'vitest';
import { handleCreateRecipe, handleGetRecentContext, handleGetRecipeContext } from './tools.js';
import type { CouchConfig } from './config.js';

const mockConfig: CouchConfig = {
  url: 'http://localhost:5984',
  database: 'test'
};

describe('handleCreateRecipe', () => {
  it('returns validation details for invalid recipe input', async () => {
    const result = await handleCreateRecipe(mockConfig, { title: 'Missing method' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid recipe input');
    expect(result.content[0].text).toContain('method must be one of');
  });

  it('marks created recipes as agent-authored before persistence', async () => {
    const result = await handleCreateRecipe(mockConfig, {
      method: 'v60',
      title: 'Unreachable test recipe'
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error creating recipe');
  });
});

describe('handleGetRecentContext', () => {
  it('returns error when CouchDB is unreachable', async () => {
    const result = await handleGetRecentContext(mockConfig, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });

  it('accepts limit parameter', async () => {
    const result = await handleGetRecentContext(mockConfig, { limit: 3 });
    expect(result).toHaveProperty('content');
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

  it('handles valid code format gracefully', async () => {
    const result = await handleGetRecipeContext(mockConfig, { code: 'COF-0001' });
    expect(result).toHaveProperty('content');
    expect(result.content[0]).toHaveProperty('text');
  });

  it('handles missing args', async () => {
    const result = await handleGetRecipeContext(mockConfig, undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid recipe code');
  });
});
