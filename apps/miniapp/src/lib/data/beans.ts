import { apiGet } from '../api';

// Row from the `bean_summaries` view (bean + active-recipe rollup).
interface BeanSummaryRow {
  id: string;
  name: string;
  roaster: string | null;
  origin: string | null;
  process: string | null;
  roast_level: string | null;
  notes: string | null;
  recipe_count: number;
  latest_recipe_at: string | null;
  has_ai: boolean;
}

export interface BeanSummary {
  id: string;
  name: string;
  roaster?: string;
  origin?: string;
  process?: string;
  roastLevel?: string;
  notes?: string;
  recipeCount: number;
  latestRecipeAt?: string;
  hasAi: boolean;
}

function rowToBean(r: BeanSummaryRow): BeanSummary {
  const b: BeanSummary = {
    id: r.id,
    name: r.name,
    recipeCount: r.recipe_count ?? 0,
    hasAi: r.has_ai ?? false,
  };
  if (r.roaster != null) b.roaster = r.roaster;
  if (r.origin != null) b.origin = r.origin;
  if (r.process != null) b.process = r.process;
  if (r.roast_level != null) b.roastLevel = r.roast_level;
  if (r.notes != null) b.notes = r.notes;
  if (r.latest_recipe_at != null) b.latestRecipeAt = r.latest_recipe_at;
  return b;
}

// Beans that have at least one active recipe, most-recent activity first.
export async function listBeans(): Promise<BeanSummary[]> {
  const rows = await apiGet<BeanSummaryRow[]>('/beans');
  return rows.map(rowToBean);
}

export async function getBean(id: string): Promise<BeanSummary | null> {
  const row = await apiGet<BeanSummaryRow | null>(`/beans/${encodeURIComponent(id)}`);
  return row ? rowToBean(row) : null;
}
