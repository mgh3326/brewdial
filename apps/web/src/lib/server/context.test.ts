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
