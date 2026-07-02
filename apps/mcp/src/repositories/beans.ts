import type { ApiConfig } from '../config.js';
import type { BeanAttributes } from '@brewdial/shared';
import { getJson, patchJson } from '../api.js';

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
  // ROB-654 structured attributes
  roast_level_ord: number | null;
  agtron_min: number | null;
  agtron_max: number | null;
  acidity: number | null;
  body: number | null;
  decaf: boolean | null;
  flavor_categories: string[] | null;
  attrs_source: string | null;
  source_url: string | null;
  attrs_notes: string | null;
}

export interface BeanInfo {
  id: string;
  name: string;
  roaster?: string;
  origin?: string;
  process?: string;
  roastLevel?: string;
  recipeCount: number;
  // ROB-654 structured attributes — surfaced so the agent can score recommendations.
  roastLevelOrd?: number;
  agtronMin?: number;
  agtronMax?: number;
  acidity?: number;
  body?: number;
  decaf?: boolean;
  flavorCategories?: string[];
  attrsSource?: string;
  sourceUrl?: string;
  attrsNotes?: string;
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
  if (r.roast_level_ord != null) b.roastLevelOrd = r.roast_level_ord;
  if (r.agtron_min != null) b.agtronMin = r.agtron_min;
  if (r.agtron_max != null) b.agtronMax = r.agtron_max;
  if (r.acidity != null) b.acidity = r.acidity;
  if (r.body != null) b.body = r.body;
  if (r.decaf != null) b.decaf = r.decaf;
  if (r.flavor_categories != null) b.flavorCategories = r.flavor_categories;
  if (r.attrs_source != null) b.attrsSource = r.attrs_source;
  if (r.source_url != null) b.sourceUrl = r.source_url;
  if (r.attrs_notes != null) b.attrsNotes = r.attrs_notes;
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
// Note: the backend /beans endpoint ignores `limit` on the no-?q branch,
// so we don't send it here. Only findBeans (which uses ?q=) sends ?limit=.
export async function listBeans(
  config: ApiConfig,
  _limit = 20,
  fetchImpl: typeof fetch = fetch
): Promise<BeanInfo[]> {
  const rows = await getJson<BeanSummaryRow[]>(config, '/api/beans', '', fetchImpl);
  return (Array.isArray(rows) ? rows : []).map(rowToBean);
}

// ROB-654: write structured attributes to a bean (agent-gated PATCH). Returns the
// updated BeanInfo, or null when the bean id does not exist (404).
export async function updateBeanAttributes(
  config: ApiConfig,
  id: string,
  patch: BeanAttributes,
  fetchImpl: typeof fetch = fetch
): Promise<BeanInfo | null> {
  try {
    const row = await patchJson<BeanSummaryRow>(
      config,
      `/api/agent/beans/${encodeURIComponent(id)}`,
      { ...patch } as Record<string, unknown>,
      fetchImpl
    );
    return rowToBean(row);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}
