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

import type { CouchConfig } from './config';
import { buildRecentContext } from './context';

const couchConfig: CouchConfig = { url: 'http://127.0.0.1:5984', database: 'coffee' };

interface AllDocsRow<T> {
  id: string;
  key: string;
  value: { rev: string };
  doc: T;
}

function recipeRow(
  code: `COF-${string}`,
  createdAt: string,
  rev = '1-r'
): AllDocsRow<RecipeDoc> {
  return {
    id: `recipe:${code}`,
    key: `recipe:${code}`,
    value: { rev },
    doc: {
      _id: `recipe:${code}`,
      _rev: rev,
      type: 'recipe',
      code,
      method: 'v60',
      version: 1,
      title: code,
      params: {},
      steps: [],
      createdBy: 'manual',
      createdAt,
      updatedAt: createdAt
    }
  };
}

function feedbackRow(
  code: `COF-${string}`,
  createdAt: string,
  ratings: FeedbackDoc['ratings'] = {},
  extras: Partial<FeedbackDoc> = {}
): AllDocsRow<FeedbackDoc> {
  const id = `feedback:${code}:${createdAt}`;
  return {
    id,
    key: id,
    value: { rev: '1-f' },
    doc: {
      _id: id,
      _rev: '1-f',
      type: 'feedback',
      recipeCode: code,
      recipeId: `recipe:${code}`,
      ratings,
      source: 'web',
      createdAt,
      updatedAt: createdAt,
      ...extras
    }
  };
}

interface BuildFetchOptions {
  recipes: AllDocsRow<RecipeDoc>[];
  feedbackByCode?: Record<string, AllDocsRow<FeedbackDoc>[]>;
  preferences?: PreferenceDoc | null;
}

function buildFetch(opts: BuildFetchOptions): typeof fetch {
  const feedbackMap = opts.feedbackByCode ?? {};
  return (async (url: string) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);

    if (path === '/coffee/_all_docs') {
      const startkey = JSON.parse(u.searchParams.get('startkey') ?? '""') as string;
      if (startkey === 'recipe:') {
        return new Response(
          JSON.stringify({ total_rows: opts.recipes.length, offset: 0, rows: opts.recipes }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      const feedbackPrefix = startkey.match(/^feedback:(COF-[^:]+):$/);
      if (feedbackPrefix) {
        const code = feedbackPrefix[1];
        const rows = feedbackMap[code] ?? [];
        return new Response(
          JSON.stringify({ total_rows: rows.length, offset: 0, rows }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('unhandled startkey ' + startkey, { status: 500 });
    }

    if (path === '/coffee/preference:global') {
      if (opts.preferences === undefined || opts.preferences === null) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(opts.preferences), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response('unhandled ' + path, { status: 500 });
  }) as unknown as typeof fetch;
}

describe('buildRecentContext', () => {
  it('clamps limit (default 5, range 1..20)', async () => {
    const recipes = Array.from({ length: 25 }, (_, i) =>
      recipeRow(`COF-${String(i + 1).padStart(4, '0')}` as `COF-${string}`,
        `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z`)
    );
    const fetchImpl = buildFetch({ recipes, preferences: null });

    const defaulted = await buildRecentContext(couchConfig, undefined, fetchImpl);
    expect(defaulted.recentRecipes).toHaveLength(5);

    const tooSmall = await buildRecentContext(couchConfig, 0, fetchImpl);
    expect(tooSmall.recentRecipes).toHaveLength(1);

    const tooBig = await buildRecentContext(couchConfig, 99, fetchImpl);
    expect(tooBig.recentRecipes).toHaveLength(20);
  });

  it('returns recent recipes newest-first with attached feedback and totals', async () => {
    const recipes = [
      recipeRow('COF-0001', '2026-04-20T00:00:00Z'),
      recipeRow('COF-0002', '2026-04-22T00:00:00Z'),
      recipeRow('COF-0003', '2026-04-21T00:00:00Z')
    ];
    const feedbackByCode: Record<string, AllDocsRow<FeedbackDoc>[]> = {
      'COF-0002': [
        feedbackRow('COF-0002', '2026-04-23T00:00:00Z', { overall: 4 }, { comment: 'fine' })
      ],
      'COF-0001': [
        feedbackRow('COF-0001', '2026-04-21T00:00:00Z', { overall: 5 }),
        feedbackRow('COF-0001', '2026-04-22T00:00:00Z', { overall: 5 })
      ],
      'COF-0003': []
    };
    const fetchImpl = buildFetch({ recipes, feedbackByCode, preferences: null });

    const out = await buildRecentContext(couchConfig, 5, fetchImpl);
    expect(out.recentRecipes.map((r) => r.recipe.code)).toEqual([
      'COF-0002',
      'COF-0003',
      'COF-0001'
    ]);
    expect(out.recentRecipes[0].feedback).toHaveLength(1);
    expect(out.recentRecipes[0].feedbackSummary.averageOverall).toBe(4);
    expect(out.recentRecipes[2].feedbackSummary.averageOverall).toBe(5);
    expect(out.totals).toEqual({ recipes: 3, feedback: 3 });
    expect(out.preferences).toBeNull();
    expect(out.guidance).toEqual([]);
    expect(typeof out.generatedAt).toBe('string');
    // ISO-ish timestamp check
    expect(Number.isNaN(Date.parse(out.generatedAt))).toBe(false);
  });

  it('returns the no-recipes guidance string when there are no recipes', async () => {
    const fetchImpl = buildFetch({ recipes: [], preferences: null });
    const out = await buildRecentContext(couchConfig, 5, fetchImpl);
    expect(out.recentRecipes).toEqual([]);
    expect(out.totals).toEqual({ recipes: 0, feedback: 0 });
    expect(out.guidance).toContain(
      'No recipes yet. Create a baseline recipe before asking for dial-in suggestions.'
    );
  });

  it('includes preferences when present', async () => {
    const fetchImpl = buildFetch({
      recipes: [recipeRow('COF-0001', '2026-04-20T00:00:00Z')],
      feedbackByCode: { 'COF-0001': [] },
      preferences: prefs
    });
    const out = await buildRecentContext(couchConfig, 5, fetchImpl);
    expect(out.preferences?.likes).toEqual(['floral', 'citrus']);
    expect(out.guidance).toContain(
      'Preferences: likes [floral, citrus]; dislikes [bitter].'
    );
  });
});
