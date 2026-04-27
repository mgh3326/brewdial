import type {
  FeedbackDoc,
  FeedbackSummary
} from '@brewdial/shared';

export function summarizeFeedback(feedback: FeedbackDoc[]): FeedbackSummary {
  if (feedback.length === 0) {
    return {
      count: 0,
      latestAt: null,
      averageOverall: null,
      commonDesiredDirections: [],
      latestComment: null
    };
  }

  let latestAt: string | null = null;
  for (const f of feedback) {
    if (latestAt === null || f.createdAt > latestAt) {
      latestAt = f.createdAt;
    }
  }

  const overalls: number[] = [];
  for (const f of feedback) {
    if (typeof f.ratings.overall === 'number') overalls.push(f.ratings.overall);
  }
  const averageOverall =
    overalls.length === 0
      ? null
      : Math.round(
          (overalls.reduce((a, b) => a + b, 0) / overalls.length) * 100
        ) / 100;

  const directionOrder = new Map<string, { count: number; firstIndex: number }>();
  let nextIndex = 0;
  for (const f of feedback) {
    for (const raw of f.desiredDirection ?? []) {
      const key = raw.trim();
      if (!key) continue;
      const entry = directionOrder.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        directionOrder.set(key, { count: 1, firstIndex: nextIndex });
        nextIndex += 1;
      }
    }
  }
  const commonDesiredDirections = [...directionOrder.entries()]
    .sort(
      (a, b) => b[1].count - a[1].count || a[1].firstIndex - b[1].firstIndex
    )
    .map(([key]) => key);

  let latestCommentDoc: FeedbackDoc | null = null;
  for (const f of feedback) {
    const trimmed = f.comment?.trim();
    if (!trimmed) continue;
    if (
      latestCommentDoc === null ||
      f.createdAt > latestCommentDoc.createdAt
    ) {
      latestCommentDoc = f;
    }
  }
  const latestComment = latestCommentDoc?.comment ?? null;

  return {
    count: feedback.length,
    latestAt,
    averageOverall,
    commonDesiredDirections,
    latestComment
  };
}
