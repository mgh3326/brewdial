// 자주 쓰는 그라인더 프리셋. 없으면 '기타'로 직접 입력.
export const GRINDER_PRESETS = [
  'KINGrinder K6',
  'Comandante C40',
  '1Zpresso J-Max',
  '1Zpresso JX-Pro',
  'Timemore C3',
  'Baratza Encore',
  'Fellow Ode Gen2',
  'Wilfa Uniform',
] as const;

// 사용자의 기본 장비를 기억해 새 레시피 폼을 미리 채운다(localStorage).
export interface Gear {
  method?: string;
  grinder?: string;
  grind?: string;
}

const KEY = 'brewdial.gear';

export function loadGear(): Gear {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Gear) : {};
  } catch {
    return {};
  }
}

export function saveGear(g: Gear): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    // ignore quota / private mode
  }
}
