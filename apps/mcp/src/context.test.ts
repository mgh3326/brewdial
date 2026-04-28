import { describe, it, expect } from 'vitest';
import { parseContextLimit, summarizeFeedback, buildContextGuidance, buildRecipeGuidance } from './context.js';
import type { FeedbackDoc, PreferenceDoc, RecipeDoc, RecipeWithFeedbackSummary } from '@brewdial/shared';

describe('parseContextLimit', () => {
  it('returns 5 for undefined', () => {
    expect(parseContextLimit(undefined)).toBe(5);
  });

  it('returns 5 for NaN', () => {
    expect(parseContextLimit(NaN)).toBe(5);
  });

  it('returns 1 for 0', () => {
    expect(parseContextLimit(0)).toBe(1);
  });

  it('returns 1 for negative numbers', () => {
    expect(parseContextLimit(-5)).toBe(1);
  });

  it('returns 20 for numbers above 20', () => {
    expect(parseContextLimit(25)).toBe(20);
  });

  it('returns the number for valid values', () => {
    expect(parseContextLimit(1)).toBe(1);
    expect(parseContextLimit(5)).toBe(5);
    expect(parseContextLimit(10)).toBe(10);
    expect(parseContextLimit(20)).toBe(20);
  });

  it('floors decimal values', () => {
    expect(parseContextLimit(5.7)).toBe(5);
  });
});

describe('summarizeFeedback', () => {
  it('returns empty summary for no feedback', () => {
    const result = summarizeFeedback([]);
    expect(result).toEqual({
      count: 0,
      latestAt: null,
      averageOverall: null,
      commonDesiredDirections: [],
      latestComment: null,
      latestRawComment: null,
      latestQuickTags: [],
      latestSource: null
    });
  });

  it('summarizes feedback correctly', () => {
    const feedback: FeedbackDoc[] = [
      {
        _id: 'feedback:COF-0001:2024-01-01T00:00:00.000Z-abc123',
        type: 'feedback',
        recipeCode: 'COF-0001',
        recipeId: 'recipe:COF-0001',
        ratings: { overall: 4, sweetness: 3 },
        comment: 'Great taste!',
        desiredDirection: ['more body'],
        source: 'web',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      },
      {
        _id: 'feedback:COF-0001:2024-01-02T00:00:00.000Z-def456',
        type: 'feedback',
        recipeCode: 'COF-0001',
        recipeId: 'recipe:COF-0001',
        ratings: { overall: 5, sweetness: 4 },
        comment: 'Even better!',
        desiredDirection: ['more body', 'less sour'],
        source: 'web',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z'
      }
    ];

    const result = summarizeFeedback(feedback);
    expect(result.count).toBe(2);
    expect(result.latestAt).toBe('2024-01-02T00:00:00.000Z');
    expect(result.averageOverall).toBe(4.5);
    expect(result.commonDesiredDirections).toContain('more body');
    expect(result.latestComment).toBe('Even better!');
    expect(result.latestRawComment).toBe('Even better!');
    expect(result.latestSource).toBe('web');
  });

  it('surfaces rawComment and quickTags from the latest doc', () => {
    const feedback: FeedbackDoc[] = [
      {
        _id: 'feedback:COF-0001:2024-01-01T00:00:00.000Z-a',
        type: 'feedback',
        recipeCode: 'COF-0001',
        recipeId: 'recipe:COF-0001',
        source: 'web',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      },
      {
        _id: 'feedback:COF-0001:2024-01-02T00:00:00.000Z-b',
        type: 'feedback',
        recipeCode: 'COF-0001',
        recipeId: 'recipe:COF-0001',
        rawComment: '산미가 강했음',
        quickTags: ['산미', '아쉬움'],
        source: 'coffee_profile',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z'
      }
    ];
    const result = summarizeFeedback(feedback);
    expect(result.latestRawComment).toBe('산미가 강했음');
    expect(result.latestQuickTags).toEqual(['산미', '아쉬움']);
    expect(result.latestSource).toBe('coffee_profile');
  });

  it('falls back to comment when rawComment is absent (legacy doc)', () => {
    const feedback: FeedbackDoc[] = [
      {
        _id: 'feedback:COF-0001:2024-01-01T00:00:00.000Z-a',
        type: 'feedback',
        recipeCode: 'COF-0001',
        recipeId: 'recipe:COF-0001',
        comment: 'legacy comment',
        source: 'web',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      }
    ];
    const result = summarizeFeedback(feedback);
    expect(result.latestRawComment).toBe('legacy comment');
    expect(result.latestQuickTags).toEqual([]);
  });
});

describe('buildContextGuidance', () => {
  it('returns guidance for no recipes', () => {
    const prefs: PreferenceDoc | null = null;
    const result = buildContextGuidance({ preferences: prefs, recipes: [] });
    expect(result).toContain('No recipes yet. Create a baseline recipe before asking for dial-in suggestions.');
  });

  it('includes preference line when preferences exist', () => {
    const prefs: PreferenceDoc = {
      _id: 'preference:global',
      type: 'preference',
      likes: ['fruity', 'light'],
      dislikes: ['bitter'],
      defaultParams: {},
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    };
    const result = buildContextGuidance({ preferences: prefs, recipes: [] });
    expect(result.some(g => g.includes('Preferences:'))).toBe(true);
  });
});

describe('buildRecipeGuidance', () => {
  it('returns guidance for no feedback', () => {
    const recipe: RecipeDoc = {
      _id: 'recipe:COF-0001',
      type: 'recipe',
      code: 'COF-0001',
      method: 'v60',
      version: 1,
      title: 'Test Recipe',
      params: {},
      steps: [],
      createdBy: 'manual',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    };
    const result = buildRecipeGuidance({
      preferences: null,
      recipe,
      feedbackSummary: {
        count: 0,
        latestAt: null,
        averageOverall: null,
        commonDesiredDirections: [],
        latestComment: null,
        latestRawComment: null,
        latestQuickTags: [],
        latestSource: null
      }
    });
    expect(result[0]).toContain('no feedback yet');
  });
});
