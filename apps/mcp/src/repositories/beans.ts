import type { ApiConfig } from '../config.js';
import { getJson } from '../api.js';

// Row from the bean_summaries view (matches DB BeanRow from @brewdial/db).
interface BeanSummaryRow {
  id: string | null;
  name: string | null;
  roaster: string | null;
  origin: string | null;
  process: string | null;
  roast_level: string | null;
  recipe_count: string | number | null; // Int8 comes back as string from pg via JSON
  latest_recipe_at: string | null;
  has_ai: boolean | null;
}

export interface BeanInfo {
  id: string;
  name: string;
  roaster?: string;
  origin?: string;
  process?: string;
  roastLevel?: string;
  recipeCount: number;
}

function rowToBean(r: BeanSummaryRow): BeanInfo {
  const b: BeanInfo = {
    id: r.id ?? '',
    name: r.name ?? '',
    recipeCount: r.recipe_count != null ? Number(r.recipe_count) : 0,
  };
  if (r.roaster != null) b.roaster = r.roaster;
  if (r.origin != null) b.origin = r.origin;
  if (r.process != null) b.process = r.process;
  if (r.roast_level != null) b.roastLevel = r.roast_level;
  return b;
}

// Fuzzy search by name/roaster substring, most recipes first.
export async function findBeans(
  config: ApiConfig,
  query: string,
  limit = 10,
  fetchImpl: typeof fetch = fetch
): Promise<BeanInfo[]> {
  const q = `q=${encodeURIComponent(query.trim())}&limit=${limit}`;
  const rows = await getJson<BeanSummaryRow[]>(config, '/api/beans', q, fetchImpl);
  return (Array.isArray(rows) ? rows : []).map(rowToBean);
}

// Recently-active beans (for browsing without a query).
export async function listBeans(
  config: ApiConfig,
  limit = 20,
  fetchImpl: typeof fetch = fetch
): Promise<BeanInfo[]> {
  const rows = await getJson<BeanSummaryRow[]>(config, '/api/beans', `limit=${limit}`, fetchImpl);
  return (Array.isArray(rows) ? rows : []).map(rowToBean);
}
