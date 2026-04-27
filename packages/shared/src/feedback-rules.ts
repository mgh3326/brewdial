import type { FeedbackRatings } from './types.js';

export interface FeedbackRatingAnalysis {
  dominantIssues: string[];
  positiveSignals: string[];
  recommendedAdjustments: string[];
}

export function summarizeFeedbackRatings(ratings: FeedbackRatings): FeedbackRatingAnalysis {
  const dominantIssues: string[] = [];
  const positiveSignals: string[] = [];
  const recommendedAdjustments: string[] = [];

  if ((ratings.burnt ?? 0) >= 3) {
    dominantIssues.push('burnt');
    recommendedAdjustments.push('Lower water temperature by 1-2°C');
    recommendedAdjustments.push('Grind slightly coarser');
    recommendedAdjustments.push('Reduce late-stage extraction or final pour agitation');
  }

  if ((ratings.astringency ?? 0) >= 3) {
    dominantIssues.push('astringency');
    recommendedAdjustments.push('Reduce agitation');
    recommendedAdjustments.push('Shorten total brew time by 10-15 seconds');
  }

  if ((ratings.sour ?? 0) >= 3) {
    dominantIssues.push('sour');
    recommendedAdjustments.push('Increase extraction slightly');
    recommendedAdjustments.push('Consider a slightly finer grind or +1°C water temperature');
  }

  if ((ratings.sweetness ?? 0) >= 3) {
    positiveSignals.push('sweetness');
  }

  if ((ratings.clarity ?? 0) >= 3) {
    positiveSignals.push('clarity');
  }

  return {
    dominantIssues,
    positiveSignals,
    recommendedAdjustments: Array.from(new Set(recommendedAdjustments))
  };
}
