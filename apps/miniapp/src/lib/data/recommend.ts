import { apiGet, apiSend } from '../api';
import { resolveIdentity } from '../identity';

export type MatchBand = 'great' | 'ok' | 'adventure' | 'unknown';
export interface AxisComparison {
  key: string;
  label: string;
  value: number | string;
  target?: number | string;
  match: 'hit' | 'near' | 'miss' | 'na';
}
export interface BeanScore {
  band: MatchBand;
  score: number;
  axes: AxisComparison[];
  why: string;
}
export interface TasteProfile {
  targets: { acidity?: number; body?: number; roast?: number };
  flavorAffinity: string[];
  penalize: string[];
  confidence: 'none' | 'low' | 'medium' | 'high';
  summary: string;
  evidence: string[];
}
export interface RecommendationsResponse {
  tasteProfile: TasteProfile;
  bands: Record<string, BeanScore>;
  ranked: string[];
}

export async function fetchRecommendations(): Promise<RecommendationsResponse> {
  const identity = await resolveIdentity();
  return apiGet<RecommendationsResponse>('/me/recommendations', { identity });
}

export async function updatePreferences(
  likes: string[],
  dislikes: string[],
): Promise<{ likes: string[]; dislikes: string[] }> {
  const identity = await resolveIdentity();
  return apiSend<{ likes: string[]; dislikes: string[] }>(
    'PUT',
    '/me/preferences',
    { likes, dislikes },
    { identity },
  );
}
