import { apiGet, apiGetOrNull } from '../api';

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
  // ROB-654 structured attributes (agent-written; UI is v2)
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
  // ROB-654 structured attributes
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

// Beans that have at least one active recipe, most-recent activity first.
export async function listBeans(): Promise<BeanSummary[]> {
  const rows = await apiGet<BeanSummaryRow[]>('/beans');
  return rows.map(rowToBean);
}

export async function getBean(id: string): Promise<BeanSummary | null> {
  const row = await apiGetOrNull<BeanSummaryRow>(`/beans/${encodeURIComponent(id)}`);
  return row ? rowToBean(row) : null;
}
