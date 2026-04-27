import { describe, expect, it } from 'vitest';
import type { FeedbackDoc } from '@brewdial/shared';
import { summarizeFeedback } from './context';

function fb(partial: Partial<FeedbackDoc> & Pick<FeedbackDoc, 'createdAt'>): FeedbackDoc {
  return {
    _id: partial._id ?? `feedback:COF-0001:${partial.createdAt}`,
    type: 'feedback',
    recipeCode: partial.recipeCode ?? 'COF-0001',
    recipeId: partial.recipeId ?? 'recipe:COF-0001',
    ratings: partial.ratings ?? {},
    source: partial.source ?? 'web',
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt ?? partial.createdAt,
    ...(partial.comment !== undefined ? { comment: partial.comment } : {}),
    ...(partial.desiredDirection !== undefined
      ? { desiredDirection: partial.desiredDirection }
      : {})
  };
}

describe('summarizeFeedback', () => {
  it('returns zero/null fields for empty feedback', () => {
    expect(summarizeFeedback([])).toEqual({
      count: 0,
      latestAt: null,
      averageOverall: null,
      commonDesiredDirections: [],
      latestComment: null
    });
  });

  it('counts entries and picks the max createdAt for latestAt', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z' }),
      fb({ createdAt: '2026-04-22T00:00:00Z' }),
      fb({ createdAt: '2026-04-21T00:00:00Z' })
    ]);
    expect(out.count).toBe(3);
    expect(out.latestAt).toBe('2026-04-22T00:00:00Z');
  });

  it('averages only overall ratings that are present, rounded to <=2 decimals', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z', ratings: { overall: 4 } }),
      fb({ createdAt: '2026-04-21T00:00:00Z', ratings: { overall: 5 } }),
      fb({ createdAt: '2026-04-22T00:00:00Z', ratings: {} }),
      fb({ createdAt: '2026-04-23T00:00:00Z', ratings: { overall: 2 } })
    ]);
    // (4 + 5 + 2) / 3 = 3.6666... -> 3.67
    expect(out.averageOverall).toBe(3.67);
  });

  it('returns averageOverall null when no feedback has overall', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z', ratings: {} }),
      fb({ createdAt: '2026-04-21T00:00:00Z', ratings: {} })
    ]);
    expect(out.averageOverall).toBeNull();
  });

  it('produces commonDesiredDirections trimmed, deduped, frequency-first then first-seen order', () => {
    const out = summarizeFeedback([
      fb({
        createdAt: '2026-04-20T00:00:00Z',
        desiredDirection: ['  sweeter ', 'less burnt', '']
      }),
      fb({
        createdAt: '2026-04-21T00:00:00Z',
        desiredDirection: ['sweeter', 'more body']
      }),
      fb({
        createdAt: '2026-04-22T00:00:00Z',
        desiredDirection: ['more body', 'less burnt']
      })
    ]);
    // counts: sweeter=2, less burnt=2, more body=2
    // first-seen order: sweeter (idx 0), less burnt (idx 1), more body (idx 2)
    expect(out.commonDesiredDirections).toEqual(['sweeter', 'less burnt', 'more body']);
  });

  it('picks the latest comment by createdAt and ignores empty/whitespace comments', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z', comment: 'first' }),
      fb({ createdAt: '2026-04-21T00:00:00Z', comment: '   ' }),
      fb({ createdAt: '2026-04-22T00:00:00Z', comment: 'newest comment' }),
      fb({ createdAt: '2026-04-23T00:00:00Z' })
    ]);
    expect(out.latestComment).toBe('newest comment');
  });

  it('returns latestComment null when no feedback has a non-empty comment', () => {
    const out = summarizeFeedback([
      fb({ createdAt: '2026-04-20T00:00:00Z' }),
      fb({ createdAt: '2026-04-21T00:00:00Z', comment: '' })
    ]);
    expect(out.latestComment).toBeNull();
  });
});

import type {
  FeedbackSummary,
  PreferenceDoc,
  RecipeDoc,
  RecipeWithFeedbackSummary
} from '@brewdial/shared';
import { buildContextGuidance, buildRecipeGuidance } from './context';

function recipe(code: `COF-${string}`): RecipeDoc {
  return {
    _id: `recipe:${code}`,
    type: 'recipe',
    code,
    method: 'v60',
    version: 1,
    title: code,
    params: {},
    steps: [],
    createdBy: 'manual',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z'
  };
}

function summary(partial: Partial<FeedbackSummary> = {}): FeedbackSummary {
  return {
    count: partial.count ?? 0,
    latestAt: partial.latestAt ?? null,
    averageOverall: partial.averageOverall ?? null,
    commonDesiredDirections: partial.commonDesiredDirections ?? [],
    latestComment: partial.latestComment ?? null
  };
}

function entry(
  code: `COF-${string}`,
  partial: Partial<FeedbackSummary> = {}
): RecipeWithFeedbackSummary {
  return { recipe: recipe(code), feedback: [], feedbackSummary: summary(partial) };
}

const prefs: PreferenceDoc = {
  _id: 'preference:global',
  type: 'preference',
  likes: ['floral', 'citrus'],
  dislikes: ['bitter'],
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z'
};

describe('buildContextGuidance', () => {
  it('emits the no-recipes hint when recipes is empty', () => {
    const out = buildContextGuidance({ preferences: null, recipes: [] });
    expect(out).toContain(
      'No recipes yet. Create a baseline recipe before asking for dial-in suggestions.'
    );
  });

  it('emits the no-feedback hint for the most recent recipe', () => {
    const out = buildContextGuidance({
      preferences: null,
      recipes: [entry('COF-0002'), entry('COF-0001', { count: 3 })]
    });
    expect(out).toContain(
      'Recent recipe COF-0002 has no feedback yet; collect tasting notes before changing parameters.'
    );
  });

  it('emits the low-average hint when averageOverall < 3', () => {
    const out = buildContextGuidance({
      preferences: null,
      recipes: [entry('COF-0003', { count: 2, averageOverall: 2.5 })]
    });
    expect(out).toContain(
      'COF-0003 average overall is below 3; inspect feedback comments and desired directions before repeating.'
    );
  });

  it('does not emit recipe hints when newest recipe has feedback with avg >= 3', () => {
    const out = buildContextGuidance({
      preferences: null,
      recipes: [entry('COF-0004', { count: 2, averageOverall: 4 })]
    });
    expect(out).toEqual([]);
  });

  it('appends a preference summary line when likes or dislikes are present', () => {
    const out = buildContextGuidance({
      preferences: prefs,
      recipes: [entry('COF-0005', { count: 1, averageOverall: 4 })]
    });
    expect(out).toContain('Preferences: likes [floral, citrus]; dislikes [bitter].');
  });

  it('omits the preference line when both likes and dislikes are empty', () => {
    const out = buildContextGuidance({
      preferences: { ...prefs, likes: [], dislikes: [] },
      recipes: [entry('COF-0006', { count: 1, averageOverall: 4 })]
    });
    expect(out.find((s) => s.startsWith('Preferences:'))).toBeUndefined();
  });
});

describe('buildRecipeGuidance', () => {
  it('emits the no-feedback hint when count is 0', () => {
    const out = buildRecipeGuidance({
      preferences: null,
      recipe: recipe('COF-0010'),
      feedbackSummary: summary({ count: 0 })
    });
    expect(out).toContain(
      'Recipe COF-0010 has no feedback yet; collect tasting notes before changing parameters.'
    );
  });

  it('emits the low-average hint when averageOverall < 3', () => {
    const out = buildRecipeGuidance({
      preferences: null,
      recipe: recipe('COF-0011'),
      feedbackSummary: summary({ count: 4, averageOverall: 2.99 })
    });
    expect(out).toContain(
      'COF-0011 average overall is below 3; inspect feedback comments and desired directions before repeating.'
    );
  });

  it('appends preference line when present', () => {
    const out = buildRecipeGuidance({
      preferences: prefs,
      recipe: recipe('COF-0012'),
      feedbackSummary: summary({ count: 2, averageOverall: 4 })
    });
    expect(out).toContain('Preferences: likes [floral, citrus]; dislikes [bitter].');
  });
});
