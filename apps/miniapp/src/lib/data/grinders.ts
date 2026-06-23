// ROB-611: read the shared grinder registry (public-read table) into GrinderInfo
// for the conversion helper (suggestGrinderClicks).

import { supabase } from '../supabase';
import { dbError } from '../labels';
import type { GrinderInfo } from '../domain';

interface GrinderRow {
  id: string;
  name: string;
  um_per_click_est: number | null;
  um_per_click_source: string | null;
  zero_ref: string | null;
  stepless: boolean;
  brew_method_ranges: Record<string, { from: number; to: number }> | null;
  notes: string | null;
}

const GRINDER_COLUMNS =
  'id,name,um_per_click_est,um_per_click_source,zero_ref,stepless,brew_method_ranges,notes';

function rowToGrinder(r: GrinderRow): GrinderInfo {
  const g: GrinderInfo = {
    id: r.id,
    name: r.name,
    stepless: r.stepless ?? false,
    brewMethodRanges: r.brew_method_ranges ?? {}
  };
  if (r.um_per_click_est != null) g.umPerClickEst = r.um_per_click_est;
  if (
    r.um_per_click_source === 'measured' ||
    r.um_per_click_source === 'estimated' ||
    r.um_per_click_source === 'unknown'
  ) {
    g.umPerClickSource = r.um_per_click_source;
  }
  if (r.zero_ref != null) g.zeroRef = r.zero_ref;
  if (r.notes != null) g.notes = r.notes;
  return g;
}

export async function listGrinders(): Promise<GrinderInfo[]> {
  const { data, error } = await supabase.from('grinders').select(GRINDER_COLUMNS).order('name');
  if (error) throw dbError('listGrinders', error.message);
  return (data as GrinderRow[]).map(rowToGrinder);
}
