// ROB-612: read the shared dripper registry (public-read table) into DripperInfo
// for the adaptation helper (suggestDripperAdaptation).

import { apiGet } from '../api';
import type { DripperInfo, DripperSizeModel } from '../domain';

interface DripperRow {
  id: string;
  name: string;
  class: string;
  geometry: string | null;
  continuum_position: number | null;
  filter_type: string | null;
  recommended_dose_range: { minG?: number; maxG?: number } | null;
  size_models: DripperSizeModel[] | null;
  notes: string | null;
}

function rowToDripper(r: DripperRow): DripperInfo {
  const d: DripperInfo = { id: r.id, name: r.name, class: r.class as DripperInfo['class'] };
  if (r.geometry != null) d.geometry = r.geometry;
  if (r.continuum_position != null) d.continuumPosition = r.continuum_position;
  if (r.filter_type != null) d.filterType = r.filter_type;
  if (r.recommended_dose_range != null) d.recommendedDoseRange = r.recommended_dose_range;
  if (Array.isArray(r.size_models)) d.sizeModels = r.size_models;
  if (r.notes != null) d.notes = r.notes;
  return d;
}

export async function listDrippers(): Promise<DripperInfo[]> {
  const rows = await apiGet<DripperRow[]>('/drippers');
  return rows.map(rowToDripper);
}
