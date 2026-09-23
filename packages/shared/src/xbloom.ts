// #587: xBloom YAML <-> RecipeDoc bidirectional mapper.
//
// Format reference: xbloom-ble (MIT) YAML — see task/2026-09-22/brewdial-xbloom-yaml-mapper.
// Roundtrip invariant: parse(toXBloomYaml(fromXBloomYaml(y))) deep-equals parse(y)
// for every field the emitter produces (key order, comments, quoting style ignored).
//
// ── Machine tag format (finalized in this task) ─────────────────────────────
// Fields with no RecipeDoc residence are preserved as bracketed `key=value` tags
// instead of being dropped. Two tag shapes exist, both space-separated `k=v` lists:
//
//   step tag    (in steps[i].note):  [label="Bloom" pattern=spiral agitation=false rpm=100 temp_c=92 pause_s=40]
//   recipe tag  (in notes):          [xbloom stage_temps=110,90 time="2:45-3:00" kind=custom water_ml=256 dripper=Omni]
//
// Grammar: value = bare `[^\s\]"]+` or `"double-quoted"` (may contain spaces; `"` and
// `]` are sanitized out on emit). A bracketed segment is a STEP tag only if every
// token parses as k=v, every key is in STEP_TAG_KEYS, and `label=` is present. A
// segment is a RECIPE tag only if its first token is the literal `xbloom` marker
// and the rest are k=v pairs with keys in RECIPE_TAG_KEYS. Human notes like
// `[see notes]`, `[1:2]`, or `[draft]` never satisfy these rules and pass through
// untouched. Residual collision (documented, accepted): a human-written bracket
// that is entirely whitelisted k=v pairs and contains `label=` is
// indistinguishable from a machine tag.
//
// Step timing: all integer seconds. endSec = round(atSec + ml/flow);
// atSec(i) = round(atSec(i-1) + dur(i-1) + pause(i-1)). Because pause_s is an
// integer, `atSec(i+1) - endSec(i) === pause(i)` exactly — the pause of every
// non-final pour is DERIVED from the schedule on export (this is what mutant M1
// attacks). The FINAL pour's pause has no successor to derive from, so it is
// carried by its step tag (`pause_s=`); tag pause_s also marks presence so an
// explicit `pause_s: 0` round-trips vs. an absent key.
//
// Hardware validity is enforced in BOTH directions: grind 1-80 (0 = 무분쇄),
// temp_c 40-95, flow_ml_s 3.0-3.5 in 0.1 steps, rpm 0 or 60-120 in steps of 10,
// pause_s 0-255, pours >= 2.

import { parse, stringify } from 'yaml';
import type { CreateRecipeInput } from './api-types.js';
import { parseClicks } from './grinder.js';
import type { RecipeParams, RecipeStep } from './types.js';
import { readGrind } from './types.js';

export class XBloomValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`invalid xBloom recipe: ${errors.join('; ')}`);
    this.name = 'XBloomValidationError';
    this.errors = errors;
  }
}

const XBLOOM_GRINDER = 'xBloom Studio';
const XBLOOM_NO_GRIND_TEXT = '무분쇄(외부 그라인더)';

// dripper (format metadata) <-> params.brewer (RecipeDoc display name).
const DRIPPER_TO_BREWER: Record<string, string> = { Omni: 'Omni Dripper 2' };
const BREWER_TO_DRIPPER: Record<string, string> = { 'Omni Dripper 2': 'Omni' };

const PATTERNS = ['spiral', 'ring', 'center'] as const;

const STEP_TAG_KEYS = new Set(['label', 'pattern', 'agitation', 'rpm', 'temp_c', 'pause_s']);
const RECIPE_TAG_KEYS = new Set(['stage_temps', 'time', 'kind', 'water_ml', 'dripper']);

interface XBloomPour {
  label: string;
  ml: number;
  temp_c?: number;
  pattern?: string;
  pause_s?: number;
  rpm?: number;
  flow_ml_s: number;
  agitation?: boolean | string;
}

interface XBloomFile {
  name: string;
  dose_g: number;
  grind: number;
  ratio: number;
  stage_temps?: number[];
  pours: XBloomPour[];
  kind?: string;
  dripper?: string;
  water_ml?: number;
  time?: string;
  note?: string;
}

/** Minimal shape accepted by toXBloomYaml — satisfied by both RecipeDoc and CreateRecipeInput. */
export interface XBloomExportSource {
  title: string;
  params?: RecipeParams;
  steps?: RecipeStep[];
  notes?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// ── tag tokenizer ───────────────────────────────────────────────────────────

// Returns k=v pairs if `content` is entirely whitespace-separated pairs, else null.
function parseTagPairs(content: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let i = 0;
  const n = content.length;
  while (i < n) {
    while (i < n && (content[i] === ' ' || content[i] === '\t')) i += 1;
    if (i >= n) break;
    const km = /^[a-z_][a-z0-9_]*=/.exec(content.slice(i));
    if (!km) return null;
    const key = km[0].slice(0, -1);
    i += km[0].length;
    if (content[i] === '"') {
      const end = content.indexOf('"', i + 1);
      if (end < 0) return null;
      out[key] = content.slice(i + 1, end);
      i = end + 1;
      if (i < n && content[i] !== ' ' && content[i] !== '\t') return null;
    } else {
      const vm = /^[^\s\]"]+/.exec(content.slice(i));
      if (!vm) return null;
      out[key] = vm[0];
      i += vm[0].length;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function tagValue(v: string): string {
  const clean = v.replace(/["\]]/g, '');
  return /[\s]/.test(clean) || clean === '' ? `"${clean}"` : clean;
}

function allKeysIn(pairs: Record<string, string>, allowed: Set<string>): boolean {
  return Object.keys(pairs).every((k) => allowed.has(k));
}

/** Extract the step tag from a note; returns { tag, text } with all tag segments stripped. */
function extractStepTag(note: string): { tag: Record<string, string> | null; text: string } {
  let tag: Record<string, string> | null = null;
  const text = note.replace(/\[([^\]]*)\]/g, (whole, content: string) => {
    const pairs = parseTagPairs(content);
    if (pairs && allKeysIn(pairs, STEP_TAG_KEYS) && 'label' in pairs) {
      tag = pairs; // last matching segment wins
      return ' ';
    }
    return whole;
  });
  return { tag, text: text.replace(/\s+/g, ' ').trim() };
}

/** Extract the `[xbloom ...]` recipe tag from notes; returns { tag, text } stripped. */
function extractRecipeTag(notes: string): { tag: Record<string, string> | null; text: string } {
  let tag: Record<string, string> | null = null;
  const text = notes.replace(/\[([^\]]*)\]/g, (whole, content: string) => {
    const m = /^xbloom[ \t]+(.*)$/.exec(content);
    if (!m) return whole;
    const pairs = parseTagPairs(m[1]);
    if (pairs && allKeysIn(pairs, RECIPE_TAG_KEYS)) {
      tag = pairs;
      return ' ';
    }
    return whole;
  });
  return { tag, text: text.replace(/\s+/g, ' ').trim() };
}

function buildStepTag(p: XBloomPour): string {
  const parts = [`label=${tagValue(p.label)}`];
  if (p.pattern !== undefined) parts.push(`pattern=${tagValue(p.pattern)}`);
  if (p.agitation !== undefined) parts.push(`agitation=${tagValue(String(p.agitation))}`);
  if (p.rpm !== undefined) parts.push(`rpm=${tagValue(String(p.rpm))}`);
  if (p.temp_c !== undefined) parts.push(`temp_c=${tagValue(String(p.temp_c))}`);
  if (p.pause_s !== undefined) parts.push(`pause_s=${tagValue(String(p.pause_s))}`);
  return `[${parts.join(' ')}]`;
}

function buildRecipeTag(f: XBloomFile): string | null {
  const parts: string[] = ['xbloom'];
  if (f.stage_temps !== undefined) parts.push(`stage_temps=${f.stage_temps.join(',')}`);
  if (f.time !== undefined) parts.push(`time=${tagValue(f.time)}`);
  if (f.kind !== undefined) parts.push(`kind=${tagValue(f.kind)}`);
  if (f.water_ml !== undefined) parts.push(`water_ml=${tagValue(String(f.water_ml))}`);
  if (f.dripper !== undefined) parts.push(`dripper=${tagValue(f.dripper)}`);
  return parts.length > 1 ? `[${parts.join(' ')}]` : null;
}

function stepProseNote(p: XBloomPour): string {
  const bits = [p.pattern ? `${p.pattern} pour` : 'pour'];
  if (p.agitation === false) bits.push('no agitation');
  else if (p.agitation === true) bits.push('agitation');
  else if (typeof p.agitation === 'string') bits.push(`agitation ${p.agitation}`);
  bits.push(`pause ${p.pause_s ?? 0}s`);
  return `${p.label}: ${bits.join(' · ')}`;
}

// ── validation ──────────────────────────────────────────────────────────────

function validatePour(p: unknown, i: number, errors: string[]): void {
  const path = `pours[${i}]`;
  if (!isPlainObject(p)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof p.label !== 'string' || p.label.trim() === '') {
    errors.push(`${path}.label is required and must be a non-empty string`);
  }
  if (typeof p.ml !== 'number' || !Number.isFinite(p.ml) || p.ml <= 0) {
    errors.push(`${path}.ml must be a positive number`);
  }
  if (typeof p.temp_c !== 'number' || !Number.isFinite(p.temp_c) || p.temp_c < 40 || p.temp_c > 95) {
    errors.push(`${path}.temp_c must be in 40-95`);
  }
  if (p.pattern !== undefined && !(PATTERNS as readonly string[]).includes(p.pattern as string)) {
    errors.push(`${path}.pattern must be one of ${PATTERNS.join('|')}`);
  }
  if (p.pause_s !== undefined) {
    if (!isInt(p.pause_s) || p.pause_s < 0 || p.pause_s > 255) {
      errors.push(`${path}.pause_s must be an integer in 0-255`);
    }
  }
  if (p.rpm !== undefined) {
    if (!isInt(p.rpm) || !(p.rpm === 0 || (p.rpm >= 60 && p.rpm <= 120 && p.rpm % 10 === 0))) {
      errors.push(`${path}.rpm must be 0 or a multiple of 10 in 60-120`);
    }
  }
  const deci = typeof p.flow_ml_s === 'number' ? p.flow_ml_s * 10 : NaN;
  if (!Number.isFinite(deci) || Math.abs(deci - Math.round(deci)) > 1e-9 || deci < 30 || deci > 35) {
    errors.push(`${path}.flow_ml_s must be in 3.0-3.5 in 0.1 steps`);
  }
  if (p.agitation !== undefined && typeof p.agitation !== 'boolean' && typeof p.agitation !== 'string') {
    errors.push(`${path}.agitation must be a boolean or string`);
  }
}

/** Validate a parsed/emitted xBloom object against hardware ranges. Throws on violation. */
export function assertXBloomRecipe(raw: unknown): asserts raw is XBloomFile {
  if (!isPlainObject(raw)) throw new XBloomValidationError(['document must be a YAML object']);
  const errors: string[] = [];
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    errors.push('name is required and must be a non-empty string');
  }
  if (typeof raw.dose_g !== 'number' || !Number.isFinite(raw.dose_g) || raw.dose_g <= 0) {
    errors.push('dose_g is required and must be a positive number');
  }
  // 0 = 무분쇄 special case; otherwise integer clicks in 1-80.
  if (!isInt(raw.grind) || !(raw.grind === 0 || (raw.grind >= 1 && raw.grind <= 80))) {
    errors.push('grind is required: 0 (무분쇄) or an integer in 1-80');
  }
  if (typeof raw.ratio !== 'number' || !Number.isFinite(raw.ratio) || raw.ratio <= 0) {
    errors.push('ratio is required and must be a positive number');
  }
  if (raw.stage_temps !== undefined) {
    if (!Array.isArray(raw.stage_temps) || !raw.stage_temps.every((t) => typeof t === 'number')) {
      errors.push('stage_temps must be a number array');
    }
  }
  if (!Array.isArray(raw.pours) || raw.pours.length < 2) {
    errors.push('pours must be an array with at least 2 entries');
  } else {
    raw.pours.forEach((p, i) => validatePour(p, i, errors));
  }
  if (raw.kind !== undefined && typeof raw.kind !== 'string') errors.push('kind must be a string');
  if (raw.dripper !== undefined && typeof raw.dripper !== 'string') {
    errors.push('dripper must be a string');
  }
  if (raw.water_ml !== undefined) {
    if (typeof raw.water_ml !== 'number' || !Number.isFinite(raw.water_ml) || raw.water_ml <= 0) {
      errors.push('water_ml must be a positive number');
    }
  }
  if (raw.time !== undefined && typeof raw.time !== 'string') errors.push('time must be a string');
  if (raw.note !== undefined && typeof raw.note !== 'string') errors.push('note must be a string');
  if (errors.length > 0) throw new XBloomValidationError(errors);
}

// "2:45-3:00" (any dash) or "2:45" -> seconds [lo, hi]; null when unparseable.
function parseTimeRange(time: string): [number, number] | null {
  const range = /^\s*(\d+)\s*:\s*(\d{1,2})\s*[-–—]\s*(\d+)\s*:\s*(\d{1,2})\s*$/.exec(time);
  if (range) return [Number(range[1]) * 60 + Number(range[2]), Number(range[3]) * 60 + Number(range[4])];
  const single = /^\s*(\d+)\s*:\s*(\d{1,2})\s*$/.exec(time);
  if (single) {
    const s = Number(single[1]) * 60 + Number(single[2]);
    return [s, s];
  }
  return null;
}

function formatTimeSec(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function parseRatio(ratio: string | undefined): number | null {
  if (!ratio) return null;
  const m = /1\s*:\s*(\d+(?:\.\d+)?)/.exec(ratio);
  return m ? Number(m[1]) : null;
}

// ── import: YAML -> CreateRecipeInput ────────────────────────────────────────

export function fromXBloomYaml(yamlText: string): CreateRecipeInput {
  const raw: unknown = parse(yamlText);
  assertXBloomRecipe(raw);

  const range = raw.time !== undefined ? parseTimeRange(raw.time) : null;
  const targetTimeSec = range ? (range[0] + range[1]) / 2 : undefined;
  const grindTarget =
    targetTimeSec !== undefined
      ? { targetDrawdownSec: targetTimeSec }
      : { brewMethodPosition: 'xBloom omni dripper' }; // GrindSpec requires a robust anchor

  const params: RecipeParams = {
    doseG: raw.dose_g,
    ratio: `1:${raw.ratio}`,
    waterG: raw.water_ml ?? Math.round(raw.dose_g * raw.ratio),
    grinder: XBLOOM_GRINDER,
    grind:
      raw.grind === 0
        ? { target: grindTarget, legacyText: XBLOOM_NO_GRIND_TEXT }
        : {
            target: grindTarget,
            perGrinder: [{ grinder: XBLOOM_GRINDER, clicks: raw.grind, source: 'measured' }]
          }
  };
  if (raw.pours[0]?.temp_c !== undefined) params.tempC = raw.pours[0].temp_c;
  if (raw.dripper !== undefined) params.brewer = DRIPPER_TO_BREWER[raw.dripper] ?? raw.dripper;
  if (targetTimeSec !== undefined) params.targetTimeSec = targetTimeSec;

  let atSec = 0;
  let cumMl = 0;
  const steps: RecipeStep[] = raw.pours.map((p, i) => {
    const dur = p.ml / p.flow_ml_s;
    cumMl = round3(cumMl + p.ml);
    const step: RecipeStep = {
      atSec,
      endSec: Math.round(atSec + dur),
      waterG: cumMl,
      pourRateGPerSec: p.flow_ml_s,
      note: `${stepProseNote(p)} ${buildStepTag(p)}`
    };
    // Next pour starts after this pour's duration + pause (integer pause keeps the
    // schedule exact: atSec(i+1) - endSec(i) === pause(i)).
    atSec = Math.round(atSec + dur + (p.pause_s ?? 0));
    return step;
  });

  const recipeTag = buildRecipeTag(raw);
  const humanNote = typeof raw.note === 'string' ? raw.note.trim() : '';
  const notes = [humanNote, recipeTag ?? ''].filter(Boolean).join('\n');
  const input: CreateRecipeInput = {
    method: 'other',
    title: raw.name,
    params,
    steps,
    beanSnapshot: { name: raw.name },
    createdBy: 'agent'
  };
  if (notes !== '') input.notes = notes;
  return input;
}

// ── export: RecipeDoc-ish -> YAML ────────────────────────────────────────────

export function toXBloomYaml(recipe: XBloomExportSource): string {
  const params = recipe.params ?? {};
  const { tag: recipeTag, text: noteText } =
    recipe.notes !== undefined ? extractRecipeTag(recipe.notes) : { tag: null, text: '' };

  const steps = recipe.steps ?? [];
  const pours = steps.map((s, i) => {
    const { tag, text } = extractStepTag(s.note ?? '');
    const prevWater = i === 0 ? 0 : (steps[i - 1].waterG ?? 0);
    const pour: Record<string, unknown> = {
      label: tag?.label ?? (text || `Pour ${i + 1}`),
      ml: round3((s.waterG ?? 0) - prevWater)
    };
    // temp: tag (roundtrip-exact) > params.tempC (authored fallback).
    const tempC = tag?.temp_c !== undefined ? Number(tag.temp_c) : params.tempC;
    if (tempC !== undefined) pour.temp_c = tempC;
    if (tag?.pattern !== undefined) pour.pattern = tag.pattern;
    else if (!tag) pour.pattern = 'spiral'; // authored recipes get the format default
    if (tag?.agitation !== undefined) {
      pour.agitation =
        tag.agitation === 'true' ? true : tag.agitation === 'false' ? false : tag.agitation;
    }
    if (tag?.rpm !== undefined) pour.rpm = Number(tag.rpm);
    if (s.pourRateGPerSec !== undefined) pour.flow_ml_s = s.pourRateGPerSec;
    // pause: derived from the schedule for non-final pours (M1 attacks this);
    // the final pour's pause only survives via its tag.
    if (i < steps.length - 1) {
      const next = steps[i + 1];
      if (typeof s.endSec === 'number' && typeof next.atSec === 'number') {
        const derived = Math.round(next.atSec - s.endSec);
        if (derived > 0 || tag?.pause_s !== undefined) pour.pause_s = derived;
      } else if (tag?.pause_s !== undefined) {
        pour.pause_s = Number(tag.pause_s);
      }
    } else if (tag?.pause_s !== undefined) {
      pour.pause_s = Number(tag.pause_s);
    }
    return pour;
  });

  const grind = readGrind(params.grind);
  const xbloomClicks = grind.perGrinder?.find((p) => p.grinder === XBLOOM_GRINDER);
  const grindOut = xbloomClicks ? (parseClicks(xbloomClicks.clicks) ?? 0) : 0;

  const ratio =
    parseRatio(params.ratio) ??
    (params.doseG && params.waterG ? round3(params.waterG / params.doseG) : undefined);

  const file: Record<string, unknown> = { name: recipe.title };
  if (params.doseG !== undefined) file.dose_g = params.doseG;
  file.grind = grindOut;
  if (ratio !== undefined) file.ratio = ratio;
  if (recipeTag?.stage_temps !== undefined) {
    file.stage_temps = recipeTag.stage_temps.split(',').map(Number);
  }
  file.pours = pours;
  file.kind = recipeTag?.kind ?? 'custom';
  const dripper =
    recipeTag?.dripper ??
    (params.brewer !== undefined ? (BREWER_TO_DRIPPER[params.brewer] ?? params.brewer) : undefined);
  if (dripper !== undefined) file.dripper = dripper;
  if (recipeTag?.water_ml !== undefined) file.water_ml = params.waterG ?? Number(recipeTag.water_ml);
  if (recipeTag?.time !== undefined) file.time = recipeTag.time;
  else if (params.targetTimeSec !== undefined) file.time = formatTimeSec(params.targetTimeSec);
  if (noteText !== '') file.note = noteText;

  assertXBloomRecipe(file);
  return stringify(file);
}
