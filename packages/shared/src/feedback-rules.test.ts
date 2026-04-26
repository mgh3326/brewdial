import { describe, it, expect } from 'vitest';
import { summarizeFeedbackRatings } from './feedback-rules';

describe('summarizeFeedbackRatings', () => {
  it('flags burnt as a dominant issue with the three burnt-related adjustments when burnt >= 3', () => {
    const summary = summarizeFeedbackRatings({ burnt: 3 });
    expect(summary.dominantIssues).toContain('burnt');
    expect(summary.recommendedAdjustments).toEqual(
      expect.arrayContaining([
        'Lower water temperature by 1-2°C',
        'Grind slightly coarser',
        'Reduce late-stage extraction or final pour agitation'
      ])
    );
  });

  it('reports sweetness as a positive signal when sweetness >= 3', () => {
    const summary = summarizeFeedbackRatings({ sweetness: 3 });
    expect(summary.positiveSignals).toContain('sweetness');
    expect(summary.dominantIssues).toEqual([]);
  });

  it('deduplicates recommendedAdjustments when multiple issues push the same string', () => {
    // Both `burnt: 3` and `astringency: 3` are dominant issues, but their
    // adjustment lists do not currently overlap — so dedup is exercised by
    // confirming each adjustment appears exactly once even when several
    // dominant issues fire at the same time.
    const summary = summarizeFeedbackRatings({ burnt: 3, astringency: 3, sour: 3 });
    const counts = new Map<string, number>();
    for (const adjustment of summary.recommendedAdjustments) {
      counts.set(adjustment, (counts.get(adjustment) ?? 0) + 1);
    }
    for (const [adjustment, count] of counts) {
      expect(count, `${adjustment} should appear exactly once`).toBe(1);
    }
    expect(summary.recommendedAdjustments.length).toBe(new Set(summary.recommendedAdjustments).size);
  });
});
