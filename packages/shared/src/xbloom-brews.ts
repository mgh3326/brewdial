/** Normalized, identifier-free xBloom machine brew data. Curve values are [cumulative water ml, cup g], sampled once per second. */
export interface XBloomBrewPour {
  volumeMl: number
  temperatureC: number
  flowRate: number
  pattern: 'spiral' | 'ring' | 'center'
  pauseSec: number
  vibrationBefore: boolean
  vibrationAfter: boolean
}

export interface XBloomBrewRecipeSnapshot {
  doseG: number
  grinderSize: number
  rpm: number
  cupType: number
  bypassEnabled: boolean
  bypassVolumeMl: number
  bypassTemperatureC: number
  pours: XBloomBrewPour[]
}

export type XBloomCurvePoint = [waterMl: number, cupG: number]

export interface XBloomBrew {
  xbloomBrewId: string
  brewedAt: string
  brewTimeSec: number
  recipeName: string
  xbloomRecipeId: string | null
  recipeSnapshot: XBloomBrewRecipeSnapshot
  curve: XBloomCurvePoint[]
}

export interface XBloomBrewMetrics {
  totalWaterMl: number
  finalCupG: number
  retentionG: number
  pourEndSec: number
  cupAtPourEndG: number
  drawdownSec: number
  earlyDrawdownGPerSec: number
}

export type ParsedXBloomBrewRecord =
  | { ok: true; value: XBloomBrew }
  | { ok: false; reason: 'broken_run' }

export interface XBloomBrewValidationResult<T> {
  ok: true
  value: T
  errors: []
}

export interface ValidationFailure {
  ok: false
  errors: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function mapPattern(value: unknown): XBloomBrewPour['pattern'] {
  const pattern = ({ 0: 'center', 1: 'ring', 2: 'spiral' } as Record<number, XBloomBrewPour['pattern']>)[Number(value ?? 2)]
  if (!pattern) throw new TypeError('pour pattern must be the xBloom center, ring, or spiral code')
  return pattern
}

function requireObject(value: unknown, allowed: readonly string[], path: string, errors: string[]): value is Record<string, unknown> {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`)
    return false
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`)
  return true
}

const BREW_KEYS = ['xbloomBrewId', 'brewedAt', 'brewTimeSec', 'recipeName', 'xbloomRecipeId', 'recipeSnapshot', 'curve'] as const
const SNAPSHOT_KEYS = ['doseG', 'grinderSize', 'rpm', 'cupType', 'bypassEnabled', 'bypassVolumeMl', 'bypassTemperatureC', 'pours'] as const
const POUR_KEYS = ['volumeMl', 'temperatureC', 'flowRate', 'pattern', 'pauseSec', 'vibrationBefore', 'vibrationAfter'] as const

/** Strict API-boundary validation: unknown keys are rejected recursively. */
export function validateXBloomBrew(input: unknown): XBloomBrewValidationResult<XBloomBrew> | ValidationFailure {
  const errors: string[] = []
  if (!requireObject(input, BREW_KEYS, 'brew', errors)) return { ok: false, errors }
  const brew = input
  if (typeof brew.xbloomBrewId !== 'string' || !/^\d+$/.test(brew.xbloomBrewId)) errors.push('xbloomBrewId must be a decimal string')
  if (typeof brew.brewedAt !== 'string' || !Number.isFinite(Date.parse(brew.brewedAt)) || new Date(brew.brewedAt).toISOString() !== brew.brewedAt) errors.push('brewedAt must be an ISO timestamp')
  if (!finite(brew.brewTimeSec) || brew.brewTimeSec <= 0) errors.push('brewTimeSec must be a positive finite number')
  if (typeof brew.recipeName !== 'string') errors.push('recipeName must be a string')
  if (brew.xbloomRecipeId !== null && (typeof brew.xbloomRecipeId !== 'string' || !/^\d+$/.test(brew.xbloomRecipeId))) errors.push('xbloomRecipeId must be a decimal string or null')

  if (requireObject(brew.recipeSnapshot, SNAPSHOT_KEYS, 'recipeSnapshot', errors)) {
    const snapshot = brew.recipeSnapshot
    for (const key of ['doseG', 'grinderSize', 'rpm', 'cupType', 'bypassVolumeMl', 'bypassTemperatureC']) {
      if (!finite(snapshot[key]) || snapshot[key] < 0) errors.push(`recipeSnapshot.${key} must be a finite non-negative number`)
    }
    if (typeof snapshot.bypassEnabled !== 'boolean') errors.push('recipeSnapshot.bypassEnabled must be a boolean')
    if (!Array.isArray(snapshot.pours)) errors.push('recipeSnapshot.pours must be an array')
    else snapshot.pours.forEach((rawPour, index) => {
      const path = `recipeSnapshot.pours[${index}]`
      if (!requireObject(rawPour, POUR_KEYS, path, errors)) return
      for (const key of ['volumeMl', 'temperatureC', 'flowRate', 'pauseSec']) {
        if (!finite(rawPour[key]) || rawPour[key] < 0) errors.push(`${path}.${key} must be a finite non-negative number`)
      }
      if (!['spiral', 'ring', 'center'].includes(String(rawPour.pattern))) errors.push(`${path}.pattern must be spiral, ring, or center`)
      if (typeof rawPour.vibrationBefore !== 'boolean') errors.push(`${path}.vibrationBefore must be a boolean`)
      if (typeof rawPour.vibrationAfter !== 'boolean') errors.push(`${path}.vibrationAfter must be a boolean`)
    })
  }
  if (!Array.isArray(brew.curve)) errors.push('curve must be an array')
  else {
    if (brew.curve.length === 0) errors.push('curve must not be empty')
    if (brew.curve.length > 1200) errors.push('curve must contain at most 1200 points')
    brew.curve.forEach((point, index) => {
      if (!Array.isArray(point) || point.length !== 2 || !finite(point[0]) || point[0] < 0 || !finite(point[1]) || point[1] < 0) errors.push(`curve[${index}] must be two finite non-negative numbers`)
    })
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: brew as unknown as XBloomBrew, errors: [] }
}

/** Maps one cloud record while only copying the explicitly allowed fields. */
export function parseXBloomBrewRecord(raw: unknown): ParsedXBloomBrewRecord {
  if (!isObject(raw)) throw new TypeError('xBloom brew record must be an object')
  if (typeof raw.brewTime === 'number' && raw.brewTime <= 0) return { ok: false, reason: 'broken_run' }
  if (raw.lineChartData == null || (typeof raw.lineChartData === 'string' && raw.lineChartData.trim() === '')) return { ok: false, reason: 'broken_run' }
  let curve: unknown
  try {
    curve = typeof raw.lineChartData === 'string' ? JSON.parse(raw.lineChartData) : raw.lineChartData
  } catch {
    throw new TypeError('lineChartData must be valid JSON')
  }
  if (!Array.isArray(curve) || curve.length === 0) return { ok: false, reason: 'broken_run' }
  if (typeof raw.brewTime !== 'number' || !Number.isFinite(raw.brewTime)) throw new TypeError('brewTime must be a finite number')
  if (!isObject(raw.recipeVo)) throw new TypeError('recipeVo must be an object')
  if (typeof raw.recipeName !== 'string') throw new TypeError('recipeName must be a string')
  const recipe = raw.recipeVo
  const recipePours = Array.isArray(recipe.pourList) ? recipe.pourList : []
  const brew: XBloomBrew = {
    xbloomBrewId: String(raw.tableId),
    brewedAt: new Date(Number(raw.createTimeStamp)).toISOString(),
    brewTimeSec: raw.brewTime,
    recipeName: raw.recipeName,
    xbloomRecipeId: recipe.tableId == null ? null : String(recipe.tableId),
    recipeSnapshot: {
      doseG: Number(recipe.dose ?? 0),
      grinderSize: Number(recipe.grinderSize ?? 0),
      rpm: Number(recipe.rpm ?? 0),
      cupType: Number(recipe.cupType ?? 0),
      bypassEnabled: Number(recipe.isEnableBypassWater) === 1,
      bypassVolumeMl: Number(recipe.bypassVolume ?? 0),
      bypassTemperatureC: Number(recipe.bypassTemp ?? 0),
      pours: recipePours.map((pour) => {
        const p = isObject(pour) ? pour : {}
        return {
          volumeMl: Number(p.volume ?? 0), temperatureC: Number(p.temperature ?? 0), flowRate: Number(p.flowRate ?? 0),
          pattern: mapPattern(p.pattern), pauseSec: Number(p.pausing ?? 0),
          vibrationBefore: Number(p.isEnableVibrationBefore) === 1, vibrationAfter: Number(p.isEnableVibrationAfter) === 1
        }
      })
    },
    curve: curve as XBloomCurvePoint[]
  }
  const validated = validateXBloomBrew(brew)
  if (!validated.ok) throw new TypeError(`invalid xBloom brew record: ${validated.errors.join('; ')}`)
  return { ok: true, value: validated.value }
}

export function deriveXBloomBrewMetrics(brew: Pick<XBloomBrew, 'curve'>): XBloomBrewMetrics {
  const curve = brew.curve
  if (curve.length === 0) throw new RangeError('brew curve must not be empty')
  const [totalWaterMl, finalCupG] = curve[curve.length - 1]
  const pourEndSec = Math.max(0, curve.findIndex(([water]) => water >= totalWaterMl))
  const cupAtPourEndG = curve[pourEndSec][1]
  const targetCupG = finalCupG * 0.98
  const targetIndex = curve.findIndex(([water, cup], index) => index >= pourEndSec && cup >= targetCupG)
  const drawdownSec = (targetIndex < 0 ? curve.length - 1 : targetIndex) - pourEndSec
  const earlyEndIndex = Math.min(curve.length - 1, pourEndSec + 10)
  const earlyDrawdownGPerSec = earlyEndIndex === pourEndSec ? 0 : (curve[earlyEndIndex][1] - cupAtPourEndG) / (earlyEndIndex - pourEndSec)
  return { totalWaterMl, finalCupG, retentionG: totalWaterMl - finalCupG, pourEndSec, cupAtPourEndG, drawdownSec, earlyDrawdownGPerSec }
}

export type XBloomBrewAnomalyHint =
  | { status: 'insufficient_baseline'; baselineCount: number }
  | { status: 'normal' | 'unusual'; baselineCount: number; metrics: Array<{ metric: keyof Pick<XBloomBrewMetrics, 'drawdownSec' | 'earlyDrawdownGPerSec' | 'finalCupG' | 'cupAtPourEndG'> | 'brewTimeSec'; baselineMedian: number; value: number; delta: number; threshold: number; flagged: boolean }>; advisory: true; note: string }

const METRIC_RULES = [
  ['brewTimeSec', 5], ['drawdownSec', 5], ['finalCupG', 3], ['cupAtPourEndG', 2], ['earlyDrawdownGPerSec', 0.1]
] as const

export type XBloomBrewAnomalyValues = Pick<XBloomBrewMetrics, 'drawdownSec' | 'earlyDrawdownGPerSec' | 'finalCupG' | 'cupAtPourEndG'> & { brewTimeSec: number }

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Compare against only prior runs of the same xBloom recipe; this is an advisory hint, never a diagnosis. */
export function hintXBloomBrewAnomaly(
  current: XBloomBrewAnomalyValues,
  baseline: XBloomBrewAnomalyValues[]
): XBloomBrewAnomalyHint {
  const runs = baseline.slice(0, 10)
  if (runs.length < 3) return { status: 'insufficient_baseline', baselineCount: runs.length }
  const metrics = METRIC_RULES.map(([metric, floor]) => {
    const values = runs.map((run) => run[metric])
    const baselineMedian = median(values)
    const mad = median(values.map((value) => Math.abs(value - baselineMedian)))
    const value = current[metric]
    const delta = value - baselineMedian
    const threshold = Math.max(3 * mad, floor)
    return { metric, baselineMedian, value, delta, threshold, flagged: Math.abs(delta) > threshold }
  })
  const unusual = metrics.some((metric) => metric.flagged)
  return {
    status: unusual ? 'unusual' : 'normal', baselineCount: runs.length, metrics, advisory: true,
    note: '클라우드 1 Hz 곡선만으로는 필터가 밀린 경우 같은 원인을 구분하기 어렵습니다. unusual 표시는 판정이 아니라 운영자에게 확인할 단서입니다.'
  }
}
