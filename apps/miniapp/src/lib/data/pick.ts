import { apiGet } from '../api';
import { resolveIdentity } from '../identity';
import type { AxisComparison, MatchBand } from './recommend';

export interface PickAnswers {
  acidity: 1 | 3 | 5;
  body: 1 | 3 | 5;
  roast: 1 | 3 | 5;
  decaf: boolean;
}

export interface PickBean {
  id: string;
  name: string | null;
  roast_level_ord: number | null;
  acidity: number | null;
  body: number | null;
  decaf: boolean | null;
  flavor_categories: string[];
}

export interface PickResponse {
  bean: PickBean | null;
  band?: MatchBand;
  axes?: AxisComparison[];
  why?: string;
  recipe?: { code: string; title: string; createdBy: string } | null;
  tasteTarget?: { acidity: number; body: number; roast: number };
  reason?: 'no_attributed_beans';
}

export async function fetchPick(answers: PickAnswers, seed: number): Promise<PickResponse> {
  const query = new URLSearchParams({
    acidity: String(answers.acidity),
    body: String(answers.body),
    roast: String(answers.roast),
    decaf: String(answers.decaf),
    seed: String(seed),
  });
  const identity = await resolveIdentity();
  return apiGet<PickResponse>(`/recommendations/pick?${query}`, { identity });
}
