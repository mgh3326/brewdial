import { supabase } from '../supabase';
import { dbError } from '../labels';

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

const BEAN_COLUMNS =
  'id,name,roaster,origin,process,roast_level,notes,recipe_count,latest_recipe_at,has_ai';

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
  const { data, error } = await supabase
    .from('bean_summaries')
    .select(BEAN_COLUMNS)
    .gt('recipe_count', 0)
    .order('latest_recipe_at', { ascending: false });
  if (error) throw dbError('listBeans', error.message);
  return (data as BeanSummaryRow[]).map(rowToBean);
}

export async function getBean(id: string): Promise<BeanSummary | null> {
  const { data, error } = await supabase
    .from('bean_summaries')
    .select(BEAN_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw dbError('getBean', error.message);
  return data ? rowToBean(data as BeanSummaryRow) : null;
}
