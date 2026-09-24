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
//   recipe tag  (in notes):          [xbloom v=1 stage_temps=110,90 time="2:45-3:00" kind=custom water_ml=256 dripper=Omni note=1]
//
// Grammar: value = bare `[^\s\]"]+` or `"double-quoted"`. Quoted values support
// backslash escapes: `\\` `\"` `\]` `\n` (an unknown `\x` keeps both chars). On
// emit, a value containing whitespace, `[`, `]`, `"` or `\` is always quoted
// with those characters escaped — nothing is stripped. A bare `[` would abort
// the quote-aware scanner's own span, which is why `[` forces quoting. A
// bracketed segment is a STEP tag only if every
// token parses as k=v, every key is in STEP_TAG_KEYS, and `label=` is present. A
// segment is a RECIPE tag only if its first token is the literal `xbloom` marker
// and the rest are k=v pairs with keys in RECIPE_TAG_KEYS. Import always emits a
// recipe tag (`v=1` marker), so tag presence distinguishes "imported" from
// "authored" recipes; `note=1` likewise records that a `note` key existed even
// when empty. Unknown keys (file- or pour-level) are preserved as `extra=`:
// encodeURIComponent(JSON.stringify({key: value})). Human notes like
// `[see notes]`, `[1:2]`, or `[draft]` never satisfy these rules and pass through
// untouched. Residual collision (documented, accepted): a human-written bracket
// that is entirely whitelisted k=v pairs and contains `label=` is
// indistinguishable from a machine tag (same for a well-formed `[xbloom …]`).
//
// agitation typing (N2): a boolean emits bare (`agitation=true`); a string that
// equals a boolean literal emits force-quoted (`agitation="true"`). On parse, a
// quoted value is always a string, a bare `true`/`false` a boolean.
//
// Human `note` text is preserved VERBATIM (newlines, double spaces, padding) —
// only the tag segment itself and the single `\n` separator that import inserts
// before a trailing tag are removed on export.
//
// Step timing: all integer seconds. endSec = round(atSec + ml/flow);
// atSec(i+1) = endSec(i) + pause(i) — integer arithmetic only, so fractional ml
// (e.g. 30.4/3.2 = 9.4999…) cannot corrupt pause through double rounding.
// `atSec(i+1) - endSec(i) === pause(i)` exactly — the pause of every non-final
// pour is DERIVED from the schedule on export (this is what mutant M1 attacks).
// The FINAL pour's pause has no successor to derive from, so it is carried by
// its step tag (`pause_s=`); tag pause_s also marks presence so an explicit
// `pause_s: 0` round-trips vs. an absent key.
//
// Pour `label` is OPTIONAL (#589: real xbloom-ble files label only the first
// pour). An absent label is recorded in the step tag as `label=""` — an empty
// label is otherwise invalid (validation rejects `label: ''`), so the empty tag
// value unambiguously means "no label key" and export omits it again. The
// step tag still always carries `label=`, so tag recognition is unchanged.
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

const STEP_TAG_KEYS = new Set(['label', 'pattern', 'agitation', 'rpm', 'temp_c', 'pause_s', 'extra']);
const RECIPE_TAG_KEYS = new Set([
  'v',
  'stage_temps',
  'time',
  'kind',
  'water_ml',
  'dripper',
  'note',
  'extra'
]);

// Keys the mapper owns; anything else in a parsed file/pour is preserved via `extra=`.
const KNOWN_FILE_KEYS = new Set([
  'name',
  'dose_g',
  'grind',
  'ratio',
  'stage_temps',
  'pours',
  'kind',
  'dripper',
  'water_ml',
  'time',
  'note'
]);
const KNOWN_POUR_KEYS = new Set([
  'label',
  'ml',
  'temp_c',
  'pattern',
  'pause_s',
  'rpm',
  'flow_ml_s',
  'agitation'
]);

interface XBloomPour {
  label?: string;
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

interface TagPairs {
  pairs: Record<string, string>;
  /** keys whose value arrived double-quoted (agitation typing depends on it) */
  quoted: Set<string>;
}

// `\n` `\"` `\]` `\\` collapse; an unknown `\x` keeps both chars verbatim.
function unescapeTagChar(c: string, next: string): string {
  if (next === 'n') return '\n';
  if (next === '"' || next === ']' || next === '\\') return next;
  return c + next;
}

// Returns k=v pairs if `content` is entirely whitespace-separated pairs, else null.
function parseTagPairs(content: string): TagPairs | null {
  const pairs: Record<string, string> = {};
  const quoted = new Set<string>();
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
      quoted.add(key);
      let val = '';
      let end = -1;
      for (let j = i + 1; j < n; j += 1) {
        const c = content[j];
        if (c === '\\' && j + 1 < n) {
          val += unescapeTagChar(c, content[j + 1]);
          j += 1;
        } else if (c === '"') {
          end = j;
          break;
        } else {
          val += c;
        }
      }
      if (end < 0) return null;
      pairs[key] = val;
      i = end + 1;
      if (i < n && content[i] !== ' ' && content[i] !== '\t') return null;
    } else {
      const vm = /^[^\s\]"]+/.exec(content.slice(i));
      if (!vm) return null;
      pairs[key] = vm[0];
      quoted.delete(key); // a later bare occurrence overrides a quoted one
      i += vm[0].length;
    }
  }
  return Object.keys(pairs).length > 0 ? { pairs, quoted } : null;
}

function escapeTagValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\]/g, '\\]').replace(/\n/g, '\\n');
}

function tagValue(v: string, forceQuote = false): string {
  // `[` also forces quoting: the bracket scanner aborts a span on an unquoted
  // `[`, so a bare value containing one would break its own tag. `\` forces
  // quoting too — escapes only exist inside quoted values.
  return forceQuote || /[\s[\]"\\]/.test(v) || v === '' ? `"${escapeTagValue(v)}"` : v;
}

function allKeysIn(pairs: Record<string, string>, allowed: Set<string>): boolean {
  return Object.keys(pairs).every((k) => allowed.has(k));
}

interface BracketSpan {
  start: number;
  end: number;
  content: string;
}

// Quote-aware bracket scanner. A `[` aborts the current span (so an unmatched
// human `[` can never swallow a later machine tag), and a `"` inside a span
// skips ahead to its pair (so a `[` or `]` inside a quoted value is inert).
// Inside quotes, `\` escapes the next char, so `\"` does not close the quote.
function* bracketSpans(s: string): Generator<BracketSpan> {
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '[') {
      i += 1;
      continue;
    }
    const open = i;
    let j = i + 1;
    let inQuote = false;
    let close = -1;
    while (j < s.length) {
      const c = s[j];
      if (inQuote) {
        if (c === '\\') j += 1;
        else if (c === '"') inQuote = false;
      } else if (c === '"') {
        inQuote = true;
      } else if (c === '[') {
        break;
      } else if (c === ']') {
        close = j;
        break;
      }
      j += 1;
    }
    if (close >= 0) {
      yield { start: open, end: close + 1, content: s.slice(open + 1, close) };
      i = close + 1;
    } else {
      i = open + 1; // unmatched '[' — resume just after it
    }
  }
}

/** Extract the step tag from a note; returns { tag, quoted, text } with all tag segments stripped. */
function extractStepTag(note: string): {
  tag: Record<string, string> | null;
  quoted: Set<string>;
  text: string;
} {
  let tag: Record<string, string> | null = null;
  let quoted = new Set<string>();
  let out = '';
  let cursor = 0;
  for (const span of bracketSpans(note)) {
    const parsed = parseTagPairs(span.content);
    if (parsed && allKeysIn(parsed.pairs, STEP_TAG_KEYS) && 'label' in parsed.pairs) {
      tag = parsed.pairs; // last matching segment wins
      quoted = parsed.quoted;
      out += note.slice(cursor, span.start);
      cursor = span.end;
    }
  }
  if (!tag) return { tag: null, quoted: new Set(), text: note };
  out += note.slice(cursor);
  return { tag, quoted, text: out.trim() };
}

/** Extract the `[xbloom ...]` recipe tag from notes; human text is kept verbatim. */
function extractRecipeTag(notes: string): { tag: Record<string, string> | null; text: string } {
  let tag: Record<string, string> | null = null;
  let out = '';
  let cursor = 0;
  let lastStart = -1;
  for (const span of bracketSpans(notes)) {
    // dotAll: a quoted value may carry a literal newline (CR:263)
    const m = /^xbloom[ \t]+(.*)$/s.exec(span.content);
    if (!m) continue;
    const parsed = parseTagPairs(m[1]);
    if (!parsed || !allKeysIn(parsed.pairs, RECIPE_TAG_KEYS)) continue;
    tag = parsed.pairs;
    out += notes.slice(cursor, span.start);
    cursor = span.end;
    lastStart = span.start;
  }
  if (!tag) return { tag: null, text: notes };
  const tail = notes.slice(cursor);
  out += tail;
  // Import appends the tag as `\n[tag]`; when a trailing tag consumed that spot,
  // drop exactly the one separator newline it implies.
  if (tail === '' && lastStart > 0 && notes[lastStart - 1] === '\n' && out.endsWith('\n')) {
    out = out.slice(0, -1);
  }
  return { tag, text: out };
}

// ── unknown-key preservation (`extra=` tags) ────────────────────────────────

function encodeExtras(obj: object, known: Set<string>): string | null {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!known.has(k) && k !== '__proto__') extras[k] = v;
  }
  if (Object.keys(extras).length === 0) return null;
  try {
    return encodeURIComponent(JSON.stringify(extras));
  } catch {
    return null; // unserializable values are dropped rather than corrupting the tag
  }
}

function decodeExtras(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(decodeURIComponent(s));
    return isPlainObject(v) ? v : null;
  } catch {
    return null;
  }
}

function buildStepTag(p: XBloomPour): string {
  const parts = [`label=${tagValue(p.label ?? '')}`]; // `label=""` = no label key
  if (p.pattern !== undefined) parts.push(`pattern=${tagValue(p.pattern)}`);
  // A string that reads as a boolean literal is force-quoted so the type
  // survives the tag (N2); other strings only quote when tagValue requires it.
  if (p.agitation !== undefined) {
    parts.push(
      `agitation=${
        typeof p.agitation === 'string'
          ? tagValue(p.agitation, p.agitation === 'true' || p.agitation === 'false')
          : String(p.agitation)
      }`
    );
  }
  if (p.rpm !== undefined) parts.push(`rpm=${tagValue(String(p.rpm))}`);
  if (p.temp_c !== undefined) parts.push(`temp_c=${tagValue(String(p.temp_c))}`);
  if (p.pause_s !== undefined) parts.push(`pause_s=${tagValue(String(p.pause_s))}`);
  const extra = encodeExtras(p, KNOWN_POUR_KEYS);
  if (extra !== null) parts.push(`extra=${extra}`);
  return `[${parts.join(' ')}]`;
}

// Import always emits a recipe tag: `v=1` marks the doc as xBloom-imported, which
// is what lets "no kind/dripper/etc." round-trip vs. authored defaults.
function buildRecipeTag(f: XBloomFile): string {
  const parts: string[] = ['xbloom', 'v=1'];
  if (f.stage_temps !== undefined) {
    parts.push(`stage_temps=${tagValue(f.stage_temps.join(','))}`); // "" = empty array
  }
  if (f.time !== undefined) parts.push(`time=${tagValue(f.time)}`);
  if (f.kind !== undefined) parts.push(`kind=${tagValue(f.kind)}`);
  if (f.water_ml !== undefined) parts.push(`water_ml=${tagValue(String(f.water_ml))}`);
  if (f.dripper !== undefined) parts.push(`dripper=${tagValue(f.dripper)}`);
  if (typeof f.note === 'string') parts.push('note=1'); // note key existed, even as ''
  const extra = encodeExtras(f, KNOWN_FILE_KEYS);
  if (extra !== null) parts.push(`extra=${extra}`);
  return `[${parts.join(' ')}]`;
}

function stepProseNote(p: XBloomPour, i: number): string {
  const bits = [p.pattern ? `${p.pattern} pour` : 'pour'];
  if (p.agitation === false) bits.push('no agitation');
  else if (p.agitation === true) bits.push('agitation');
  else if (typeof p.agitation === 'string') bits.push(`agitation ${p.agitation}`);
  bits.push(`pause ${p.pause_s ?? 0}s`);
  return `${p.label ?? `Pour ${i + 1}`}: ${bits.join(' · ')}`;
}

// ── validation ──────────────────────────────────────────────────────────────

function validatePour(p: unknown, i: number, errors: string[]): void {
  const path = `pours[${i}]`;
  if (!isPlainObject(p)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (p.label !== undefined && (typeof p.label !== 'string' || p.label.trim() === '')) {
    errors.push(`${path}.label must be a non-empty string when present`);
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
    const endSec = Math.round(atSec + p.ml / p.flow_ml_s);
    if (endSec <= atSec) {
      // RecipeStep requires endSec > atSec; a sub-second pour is unrepresentable.
      throw new XBloomValidationError([
        `pours[${i}] rounds to <1s of brew time (ml/flow_ml_s too small) and cannot be represented`
      ]);
    }
    cumMl = round3(cumMl + p.ml);
    const step: RecipeStep = {
      atSec,
      endSec,
      waterG: cumMl,
      pourRateGPerSec: p.flow_ml_s,
      note: `${stepProseNote(p, i)} ${buildStepTag(p)}`
    };
    // Next pour starts at endSec + pause — pure integer arithmetic, so fractional
    // ml (e.g. 30.4/3.2 = 9.4999…) cannot shift pause through double rounding.
    atSec = endSec + (p.pause_s ?? 0);
    return step;
  });

  const recipeTag = buildRecipeTag(raw);
  const humanNote = typeof raw.note === 'string' ? raw.note : '';
  const notes = [humanNote, recipeTag].filter(Boolean).join('\n');
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
    const { tag, quoted, text } = extractStepTag(s.note ?? '');
    const prevWater = i === 0 ? 0 : (steps[i - 1].waterG ?? 0);
    const pour: Record<string, unknown> = {};
    // tag label "" = the source pour had no label key; keep it absent.
    const label = tag ? tag.label : text || `Pour ${i + 1}`;
    if (label !== '') pour.label = label;
    pour.ml = round3((s.waterG ?? 0) - prevWater);
    // temp: for the FIRST pour params.tempC is the spec'd mapping and wins, so a
    // user edit in BrewDial propagates; later pours rely on their tags (or the
    // params.tempC fallback for authored recipes).
    const tempC =
      i === 0 && params.tempC !== undefined
        ? params.tempC
        : tag?.temp_c !== undefined
          ? Number(tag.temp_c)
          : params.tempC;
    if (tempC !== undefined) pour.temp_c = tempC;
    if (tag?.pattern !== undefined) pour.pattern = tag.pattern;
    else if (!tag) pour.pattern = 'spiral'; // authored recipes get the format default
    if (tag?.agitation !== undefined) {
      // quoted value = string (even "true"/"false"); bare true/false = boolean
      pour.agitation =
        quoted.has('agitation') || (tag.agitation !== 'true' && tag.agitation !== 'false')
          ? tag.agitation
          : tag.agitation === 'true';
    }
    if (tag?.rpm !== undefined) pour.rpm = Number(tag.rpm);
    if (s.pourRateGPerSec !== undefined) pour.flow_ml_s = s.pourRateGPerSec;
    if (tag?.extra !== undefined) {
      const extra = decodeExtras(tag.extra);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          if (k !== '__proto__' && !KNOWN_POUR_KEYS.has(k)) pour[k] = v;
        }
      }
    }
    // pause: derived from the schedule for non-final pours (M1 attacks this);
    // the final pour's pause only survives via its tag. A negative derivation
    // means the steps overlap — an impossible schedule, so reject loudly.
    if (i < steps.length - 1) {
      const next = steps[i + 1];
      if (typeof s.endSec === 'number' && typeof next.atSec === 'number') {
        const derived = Math.round(next.atSec - s.endSec);
        if (derived < 0) {
          throw new XBloomValidationError([
            `steps[${i}] endSec exceeds steps[${i + 1}] atSec (pours would overlap)`
          ]);
        }
        if (derived > 0 || tag?.pause_s !== undefined) pour.pause_s = derived;
      } else if (tag?.pause_s !== undefined) {
        pour.pause_s = Number(tag.pause_s);
      }
    } else if (tag?.pause_s !== undefined) {
      pour.pause_s = Number(tag.pause_s);
    }
    return pour;
  });

  // grind: only xBloom Studio clicks translate. ANY other grind information —
  // another grinder's clicks, unrelated legacy text, or a target-only GrindSpec
  // (e.g. "v60 medium-fine") — must NOT silently become 0 (the machine would
  // skip grinding); reject instead. Only no grind info at all, or the explicit
  // 무분쇄 marker, maps to 0.
  const grind = readGrind(params.grind);
  const xbloomClicks = grind.perGrinder?.find((p) => p.grinder === XBLOOM_GRINDER);
  let grindOut: number;
  if (xbloomClicks) {
    const clicks = parseClicks(xbloomClicks.clicks);
    if (clicks === null) {
      throw new XBloomValidationError([
        `unparseable xBloom Studio clicks: ${String(xbloomClicks.clicks)}`
      ]);
    }
    grindOut = clicks;
  } else if (grind.legacyText === XBLOOM_NO_GRIND_TEXT) {
    grindOut = 0;
  } else if (
    (grind.perGrinder !== undefined && grind.perGrinder.length > 0) ||
    (grind.legacyText !== undefined && grind.legacyText !== '') ||
    grind.target.brewMethodPosition !== undefined ||
    grind.target.microns !== undefined ||
    grind.target.targetDrawdownSec !== undefined
  ) {
    throw new XBloomValidationError([
      'cannot translate a non-xBloom grind into xBloom clicks (add a measured "xBloom Studio" entry or 무분쇄 legacyText)'
    ]);
  } else {
    grindOut = 0;
  }

  const ratio =
    parseRatio(params.ratio) ??
    (params.doseG && params.waterG ? round3(params.waterG / params.doseG) : undefined);

  const file: Record<string, unknown> = { name: recipe.title };
  if (params.doseG !== undefined) file.dose_g = params.doseG;
  file.grind = grindOut;
  if (ratio !== undefined) file.ratio = ratio;
  if (recipeTag?.stage_temps !== undefined) {
    file.stage_temps =
      recipeTag.stage_temps === '' ? [] : recipeTag.stage_temps.split(',').map(Number);
  }
  file.pours = pours;
  // kind: imported recipes emit exactly what the tag recorded (nothing when the
  // source had no kind); authored recipes get the format default.
  if (recipeTag === null) file.kind = 'custom';
  else if (recipeTag.kind !== undefined) file.kind = recipeTag.kind;
  // dripper: same rule as `time` — the tag value holds only while params.brewer
  // is absent or still equals the brewer the tag maps to; a user edit wins (CR:632).
  const tagDripper = recipeTag?.dripper;
  const tagBrewer =
    tagDripper !== undefined ? (DRIPPER_TO_BREWER[tagDripper] ?? tagDripper) : undefined;
  const dripper =
    params.brewer === undefined || params.brewer === tagBrewer
      ? tagDripper
      : (BREWER_TO_DRIPPER[params.brewer] ?? params.brewer);
  if (dripper !== undefined) file.dripper = dripper;
  if (recipeTag?.water_ml !== undefined) file.water_ml = params.waterG ?? Number(recipeTag.water_ml);
  // time: the tag preserves the original range string, but only while
  // targetTimeSec still equals its midpoint — a user edit rewrites the field.
  if (recipeTag?.time !== undefined) {
    const r = parseTimeRange(recipeTag.time);
    const mid = r ? (r[0] + r[1]) / 2 : null;
    file.time =
      params.targetTimeSec === undefined || params.targetTimeSec === mid
        ? recipeTag.time
        : formatTimeSec(params.targetTimeSec);
  } else if (params.targetTimeSec !== undefined) {
    file.time = formatTimeSec(params.targetTimeSec);
  }
  if (recipeTag?.extra !== undefined) {
    const extra = decodeExtras(recipeTag.extra);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (k !== '__proto__' && !KNOWN_FILE_KEYS.has(k)) file[k] = v;
      }
    }
  }
  if (noteText !== '' || recipeTag?.note !== undefined) file.note = noteText;

  assertXBloomRecipe(file);
  return stringify(file);
}
