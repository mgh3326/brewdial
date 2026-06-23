import type { SupabaseConfig } from '../config.js';
import { selectRows } from '../supabase.js';

// Row from the shared grinder registry (ROB-611).
interface GrinderRow {
  id: string;
  name: string;
  um_per_click_est: number | null;
  um_per_click_source: string | null;
  stepless: boolean;
  brew_method_ranges: Record<string, { from: number; to: number }> | null;
  notes: string | null;
}

export interface GrinderEntry {
  name: string;
  umPerClickEst?: number; // advisory only — absolute microns are unreliable
  stepless: boolean;
  brewMethodRanges: Record<string, { from: number; to: number }>;
  notes?: string;
}

const GRINDER_COLUMNS =
  'id,name,um_per_click_est,um_per_click_source,stepless,brew_method_ranges,notes';

function rowToEntry(r: GrinderRow): GrinderEntry {
  const g: GrinderEntry = {
    name: r.name,
    stepless: r.stepless ?? false,
    brewMethodRanges: r.brew_method_ranges ?? {}
  };
  if (r.um_per_click_est != null) g.umPerClickEst = r.um_per_click_est;
  if (r.notes != null) g.notes = r.notes;
  return g;
}

// The full grinder registry (canonical names + per-method click bands). The agent
// reads this to (a) use the EXACT registry name in params.grind.perGrinder so the
// mini-app's read-time conversion matches, and (b) sanity-check click bands.
export async function listGrinders(
  config: SupabaseConfig,
  fetchImpl: typeof fetch = fetch
): Promise<GrinderEntry[]> {
  const rows = await selectRows<GrinderRow>(
    config,
    'grinders',
    `select=${GRINDER_COLUMNS}&order=name`,
    fetchImpl
  );
  return rows.map(rowToEntry);
}
