// User-facing Korean labels for internal field keys + a localizer that keeps
// English validator/DB messages from leaking into the Korean UI.

export const PARAM_LABELS: Record<string, string> = {
  doseG: '원두(g)',
  waterG: '물(g)',
  ratio: '비율',
  tempC: '온도(℃)',
  grind: '분쇄도',
  grinder: '그라인더',
  brewer: '드리퍼',
  targetTimeSec: '목표 시간(초)',
};

export const RATING_LABELS: Record<string, string> = {
  overall: '전체 평가',
  sweetness: '단맛',
  body: '바디',
  clarity: '클린함',
  sour: '산미',
  bitter: '쓴맛',
  burnt: '탄맛',
  astringency: '떫음',
};

export function paramLabel(key: string): string {
  return PARAM_LABELS[key] ?? key;
}
export function ratingLabel(key: string): string {
  return RATING_LABELS[key] ?? key;
}

// Map an English validator/PostgREST message to a friendly Korean string.
// Unknown messages fall back to a generic line so internal field names never
// reach the user.
export function localizeMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('title is required')) return '제목을 입력해 주세요.';
  if (m.includes('tempc must be between')) return '온도는 0~100℃ 사이여야 해요.';
  if (m.includes('tempc') && m.includes('low')) return '물 온도가 뜨거운 추출치고 낮아요.';
  if (m.includes('doseg must be greater')) return '원두량은 0보다 커야 해요.';
  if (m.includes('waterg must be greater')) return '물량은 0보다 커야 해요.';
  if (m.includes('targettimesec must be greater')) return '목표 시간은 0보다 커야 해요.';
  if (m.includes('ratio') && m.includes('disagrees')) return '비율이 원두·물량과 맞지 않아요. 확인해 주세요.';
  if (m.includes('overlap')) return '푸어 단계 시간이 서로 겹쳐요.';
  if (m.includes('decreases')) return '누적 물량이 줄어드는 단계가 있어요.';
  if (m.includes('exceeds total')) return '한 단계의 물량이 총 물량을 넘어요.';
  if (m.includes('does not reach')) return '마지막 단계 물량이 총 물량에 못 미쳐요.';
  if (m.includes('before the last pour ends')) return '목표 시간이 마지막 푸어보다 빨라요.';
  if (m.includes('drawdown')) return '목표 시간이 마지막 푸어 뒤로 너무 길어요.';
  if (m.includes('outside the typical')) return '목표 시간이 보통 범위(1~10분)를 벗어나요.';
  if (m.includes('no endsec')) return '일부 단계에 종료 시간이 없어 타이밍을 다 확인할 수 없어요.';
  if (m.includes('at least one of')) return '평점·태그·코멘트 중 하나는 입력해 주세요.';
  if (m.includes('must be a finite number') || m.includes('must be a number')) return '숫자를 정확히 입력해 주세요.';
  if (m.includes('must be a non-empty') || m.includes('must be')) return '입력값을 확인해 주세요.';
  if (m.includes('row-level security') || m.includes('permission') || m.includes('not allowed')) {
    return '권한이 없어요. 잠시 후 다시 시도해 주세요.';
  }
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('fetch')) {
    return '네트워크 연결을 확인해 주세요.';
  }
  return '문제가 발생했어요. 잠시 후 다시 시도해 주세요.';
}

// Log the raw cause for debugging, return a user-safe localized Error.
export function dbError(context: string, raw: string): Error {
  console.error(`[brewdial] ${context}:`, raw);
  return new Error(localizeMessage(raw));
}
