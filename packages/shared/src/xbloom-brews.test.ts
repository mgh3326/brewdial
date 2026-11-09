import { describe, expect, it } from 'vitest'
import { deriveXBloomBrewMetrics, hintXBloomBrewAnomaly, parseXBloomBrewRecord, validateXBloomBrew, type XBloomBrew } from './xbloom-brews.js'

function rawRecord(brewTime = 4, lineChartData: unknown = '[[0,0],[20,3],[40,8],[40,12],[40,20]]') {
  return {
    tableId: 123, createTimeStamp: 1794211200000, brewTime, recipeName: 'Handmade fixture', resultState: 2,
    lineChartData, mac: 'fixture-mac', machineId: 1, theMemberId: 2, memberUsedRecipesId: 3,
    podsVo: {}, brewing_method: 1, desired: {}, isDefault: 0, isHavePod: 0, adaptedModel: 1, _group: 'fixture',
    recipeVo: {
      tableId: 456, theName: 'Fixture recipe', dose: 15, grinderSize: 40, rpm: 80, cupType: 1,
      isEnableBypassWater: 1, bypassVolume: 120, bypassTemp: 80, pourCount: 1, grandWater: 5,
      creatorId: 'private', shareRecipeLink: 'private', theColor: 'red', theSubsetId: 1,
      pourList: [{ volume: 40, temperature: 92, flowRate: 3, pattern: 2, pausing: 5, isEnableVibrationBefore: 1, isEnableVibrationAfter: 0, tableId: 1, recipeId: 2, theName: 'ignored' }]
    }
  }
}

function run(time: number, drawdown: number, finalCup: number, cupAtEnd: number, early: number): Pick<XBloomBrew, 'brewTimeSec'> & ReturnType<typeof deriveXBloomBrewMetrics> {
  return { brewTimeSec: time, totalWaterMl: 200, finalCupG: finalCup, retentionG: 200 - finalCup, pourEndSec: 100, cupAtPourEndG: cupAtEnd, drawdownSec: drawdown, earlyDrawdownGPerSec: early }
}

describe('xBloom brew records', () => {
  it('parses a cloud record to an identifier-free normalized brew', () => {
    const parsed = parseXBloomBrewRecord(rawRecord())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual({
      xbloomBrewId: '123', brewedAt: new Date(1794211200000).toISOString(), brewTimeSec: 4, recipeName: 'Handmade fixture', xbloomRecipeId: '456',
      recipeSnapshot: { doseG: 15, grinderSize: 40, rpm: 80, cupType: 1, bypassEnabled: true, bypassVolumeMl: 120, bypassTemperatureC: 80,
        pours: [{ volumeMl: 40, temperatureC: 92, flowRate: 3, pattern: 'spiral', pauseSec: 5, vibrationBefore: true, vibrationAfter: false }] },
      curve: [[0, 0], [20, 3], [40, 8], [40, 12], [40, 20]]
    })
    const flattened = JSON.stringify(parsed.value)
    for (const identifier of ['mac', 'machineId', 'theMemberId', 'memberUsedRecipesId', 'podsVo', 'brewing_method', 'desired', 'isDefault', 'isHavePod', 'adaptedModel', '_group', 'creatorId', 'shareRecipeLink', 'theColor', 'theSubsetId']) {
      expect(flattened).not.toContain(identifier)
    }
  })

  it('maps xBloom pattern codes to the shared step names', () => {
    for (const [code, pattern] of [[0, 'center'], [1, 'ring'], [2, 'spiral']] as const) {
      const raw = rawRecord()
      raw.recipeVo.pourList[0]!.pattern = code
      const parsed = parseXBloomBrewRecord(raw)
      expect(parsed.ok && parsed.value.recipeSnapshot.pours[0]?.pattern).toBe(pattern)
    }
  })

  it('returns a typed skip for broken runs', () => {
    expect(parseXBloomBrewRecord(rawRecord(0, 'malformed but ignored for broken run'))).toEqual({ ok: false, reason: 'broken_run' })
    expect(parseXBloomBrewRecord(rawRecord(20, '  '))).toEqual({ ok: false, reason: 'broken_run' })
    expect(parseXBloomBrewRecord(rawRecord(20, '[]'))).toEqual({ ok: false, reason: 'broken_run' })
  })

  it('strictly validates normalized brew keys and curve points', () => {
    const parsed = parseXBloomBrewRecord(rawRecord())
    if (!parsed.ok) throw new Error('fixture should parse')
    expect(validateXBloomBrew(parsed.value).ok).toBe(true)
    expect(validateXBloomBrew({ ...parsed.value, mac: 'unexpected' }).ok).toBe(false)
    expect(validateXBloomBrew({ ...parsed.value, curve: [[1, Number.NaN]] }).ok).toBe(false)
    expect(validateXBloomBrew({ ...parsed.value, curve: Array.from({ length: 1201 }, () => [1, 1]) }).ok).toBe(false)
    expect(validateXBloomBrew({ ...parsed.value, xbloomBrewId: '1'.repeat(33) }).ok).toBe(false)
    expect(validateXBloomBrew({ ...parsed.value, xbloomRecipeId: '1'.repeat(33) }).ok).toBe(false)
    expect(validateXBloomBrew({ ...parsed.value, recipeName: 'unsafe\u0000name' }).ok).toBe(false)
    expect(validateXBloomBrew({ ...parsed.value, recipeName: 'x'.repeat(65536) }).ok).toBe(false)
  })

  it('derives pour end, retention, drawdown, and early drawdown from the 1 Hz curve', () => {
    const parsed = parseXBloomBrewRecord(rawRecord())
    if (!parsed.ok) throw new Error('fixture should parse')
    expect(deriveXBloomBrewMetrics(parsed.value)).toEqual({ totalWaterMl: 40, finalCupG: 20, retentionG: 20, pourEndSec: 2, cupAtPourEndG: 8, drawdownSec: 2, earlyDrawdownGPerSec: 6 })
  })

  it('flags the specified slower drawdown and lower pour-end cup weight against four prior runs', () => {
    const baseline = [run(170, 40, 200, 128, 1.8), run(171, 41, 201, 129, 1.9), run(172, 42, 199, 127, 2), run(173, 43, 200, 128, 2.1)]
    const hint = hintXBloomBrewAnomaly(run(171, 47.5, 200, 125.5, 1.9), baseline)
    expect(hint.status).toBe('unusual')
    if (hint.status !== 'insufficient_baseline') expect(hint.metrics.filter((metric) => metric.flagged).map((metric) => metric.metric)).toEqual(['drawdownSec', 'cupAtPourEndG'])
  })

  it('requires at least three baseline runs', () => {
    expect(hintXBloomBrewAnomaly(run(170, 40, 200, 128, 1.8), [run(170, 40, 200, 128, 1.8), run(171, 41, 200, 128, 1.8)])).toEqual({ status: 'insufficient_baseline', baselineCount: 2 })
  })

  it('uses three times MAD when baseline spread exceeds the metric floors', () => {
    const baseline = [run(170, 30, 190, 120, 1), run(170, 40, 200, 130, 2), run(170, 50, 210, 140, 3)]
    const hint = hintXBloomBrewAnomaly(run(170, 80, 220, 150, 4), baseline)
    expect(hint.status).toBe('unusual')
    if (hint.status !== 'insufficient_baseline') expect(hint.metrics.find((metric) => metric.metric === 'drawdownSec')?.threshold).toBe(30)
  })
})
