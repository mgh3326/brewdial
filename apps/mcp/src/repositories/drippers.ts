import type { SupabaseConfig } from '../config.js';
import { selectRows } from '../supabase.js';

// Row from the shared dripper registry (ROB-612).
interface DripperRow {
  id: string;
  name: string;
  class: string;
  geometry: string | null;
  continuum_position: number | null;
  filter_type: string | null;
  recommended_dose_range: { minG?: number; maxG?: number } | null;
  size_models: { model: string; maxDoseG?: number }[] | null;
  notes: string | null;
}

export interface DripperEntry {
  name: string;
  class: string;
  geometry?: string;
  continuumPosition?: number; // 0 fast/bed-controlled .. 1 slow/dripper-controlled
  filterType?: string;
  recommendedDoseRange?: { minG?: number; maxG?: number };
  sizeModels?: { model: string; maxDoseG?: number }[];
  notes?: string;
}

const DRIPPER_COLUMNS =
  'id,name,class,geometry,continuum_position,filter_type,recommended_dose_range,size_models,notes';

function rowToEntry(r: DripperRow): DripperEntry {
  const d: DripperEntry = { name: r.name, class: r.class };
  if (r.geometry != null) d.geometry = r.geometry;
  if (r.continuum_position != null) d.continuumPosition = r.continuum_position;
  if (r.filter_type != null) d.filterType = r.filter_type;
  if (r.recommended_dose_range != null) d.recommendedDoseRange = r.recommended_dose_range;
  if (Array.isArray(r.size_models)) d.sizeModels = r.size_models;
  if (r.notes != null) d.notes = r.notes;
  return d;
}

// The full dripper registry (canonical name + class + flow-restriction continuum +
// recommended dose / size models). The agent reads this to use EXACT registry names
// in dripperPortability.origin and to reason about size/bed for large doses.
export async function listDrippers(
  config: SupabaseConfig,
  fetchImpl: typeof fetch = fetch
): Promise<DripperEntry[]> {
  const rows = await selectRows<DripperRow>(
    config,
    'drippers',
    `select=${DRIPPER_COLUMNS}&order=continuum_position`,
    fetchImpl
  );
  return rows.map(rowToEntry);
}
