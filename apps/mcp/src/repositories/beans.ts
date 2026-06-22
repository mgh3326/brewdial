import type { SupabaseConfig } from '../config.js';
import { selectRows } from '../supabase.js';

// Row from the bean_summaries view (bean + active-recipe rollup).
interface BeanSummaryRow {
  id: string;
  name: string;
  roaster: string | null;
  origin: string | null;
  process: string | null;
  roast_level: string | null;
  recipe_count: number;
  latest_recipe_at: string | null;
  has_ai: boolean;
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

const BEAN_COLUMNS = 'id,name,roaster,origin,process,roast_level,recipe_count,latest_recipe_at,has_ai';

function rowToBean(r: BeanSummaryRow): BeanInfo {
  const b: BeanInfo = { id: r.id, name: r.name, recipeCount: r.recipe_count ?? 0 };
  if (r.roaster != null) b.roaster = r.roaster;
  if (r.origin != null) b.origin = r.origin;
  if (r.process != null) b.process = r.process;
  if (r.roast_level != null) b.roastLevel = r.roast_level;
  return b;
}

// Fuzzy-ish search by name/roaster substring (ILIKE), most recipes first.
// Lets the agent map a new recipe onto an EXISTING bean instead of splitting it.
export async function findBeans(
  config: SupabaseConfig,
  query: string,
  limit = 10,
  fetchImpl: typeof fetch = fetch
): Promise<BeanInfo[]> {
  const q = encodeURIComponent(`*${query.trim()}*`);
  const rows = await selectRows<BeanSummaryRow>(
    config,
    'bean_summaries',
    `or=(name.ilike.${q},roaster.ilike.${q})&select=${BEAN_COLUMNS}&order=recipe_count.desc&limit=${limit}`,
    fetchImpl
  );
  return rows.map(rowToBean);
}

// Recently-active beans (for browsing without a query).
export async function listBeans(
  config: SupabaseConfig,
  limit = 20,
  fetchImpl: typeof fetch = fetch
): Promise<BeanInfo[]> {
  const rows = await selectRows<BeanSummaryRow>(
    config,
    'bean_summaries',
    `recipe_count=gt.0&select=${BEAN_COLUMNS}&order=latest_recipe_at.desc&limit=${limit}`,
    fetchImpl
  );
  return rows.map(rowToBean);
}
