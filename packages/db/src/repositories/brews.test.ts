// No database: insertXBloomBrews runs against a Kysely instance whose driver answers
// from an in-memory set of stored brew ids. The `log` callback counts the statements
// Kysely actually emits, so these tests pin the statement count and the result contract.
import { describe, expect, test } from 'vitest'
import {
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely'
import type { XBloomBrew } from '@brewdial/shared'
import type { DB } from '../types.js'
import { insertXBloomBrews } from './brews.js'

function curve(): Array<[number, number]> {
  const points: Array<[number, number]> = [[0, 0], [220, 120]]
  for (let second = 2; second <= 11; second += 1) points.push([220, second === 2 ? 196 : second === 3 ? 199 : 200])
  return points
}

function brew(id: string): XBloomBrew {
  return {
    xbloomBrewId: id, brewedAt: '2026-11-20T10:00:00.000Z', brewTimeSec: 180, recipeName: 'Invented fixture',
    xbloomRecipeId: '81000000000001',
    recipeSnapshot: { doseG: 18, grinderSize: 42, rpm: 80, cupType: 1, bypassEnabled: true, bypassVolumeMl: 100, bypassTemperatureC: 80, pours: [] },
    curve: curve()
  } as unknown as XBloomBrew
}

interface Harness {
  db: Kysely<DB>
  statements: Array<'SELECT' | 'INSERT'>
}

// `stored` answers existence checks; `insertErrors` makes the INSERT for an id throw.
function harness(stored: string[], insertErrors: Record<string, unknown> = {}): Harness {
  const storedSet = new Set(stored)
  const statements: Array<'SELECT' | 'INSERT'> = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      const text = query.sql.trim().toLowerCase()
      if (text.startsWith('select')) {
        const rows = query.parameters
          .filter((p): p is string => typeof p === 'string' && storedSet.has(p))
          .map((id) => ({ xbloom_brew_id: id }))
        return { rows: rows as R[] }
      }
      for (const id of query.parameters) {
        if (typeof id === 'string' && id in insertErrors) throw insertErrors[id]
      }
      return { rows: [], numAffectedRows: BigInt(1) }
    },
    async *streamQuery() { throw new Error('not used') }
  }
  const driver: Driver = {
    async init() {},
    async acquireConnection() { return connection },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {}
  }
  const dialect: Dialect = {
    createAdapter: () => new MysqlAdapter(),
    createDriver: () => driver,
    createQueryCompiler: () => new MysqlQueryCompiler(),
    createIntrospector: (db) => new MysqlIntrospector(db)
  }
  const db = new Kysely<DB>({
    dialect,
    log: (event) => {
      if (event.level !== 'query') return
      const text = event.query.sql.trim().toLowerCase()
      statements.push(text.startsWith('select') ? 'SELECT' : 'INSERT')
    }
  })
  return { db, statements }
}

describe('insertXBloomBrews — statement count', () => {
  test('one call with 1 new id and 6 stored ids issues 1 SELECT and 1 INSERT', async () => {
    const stored = ['1001', '1002', '1003', '1004', '1005', '1006']
    const { db, statements } = harness(stored)
    const brews = ['1001', '1002', '1003', '1004', '1005', '1006', '2001'].map(brew)

    const result = await insertXBloomBrews(db, brews)

    expect(statements.filter((s) => s === 'SELECT')).toHaveLength(1)
    expect(statements.filter((s) => s === 'INSERT')).toHaveLength(1)
    expect(result).toEqual({ inserted: ['2001'], duplicate: stored })
  })

  test('empty input issues no statements and returns empty arrays', async () => {
    const { db, statements } = harness(['1001'])

    await expect(insertXBloomBrews(db, [])).resolves.toEqual({ inserted: [], duplicate: [] })
    expect(statements).toEqual([])
  })
})

describe('insertXBloomBrews — result contract', () => {
  test('an id already stored is reported as duplicate and not inserted', async () => {
    const { db, statements } = harness(['1001'])

    const result = await insertXBloomBrews(db, [brew('1001')])

    expect(result).toEqual({ inserted: [], duplicate: ['1001'] })
    expect(statements.filter((s) => s === 'INSERT')).toHaveLength(0)
  })

  test('a new id is inserted', async () => {
    const { db } = harness([])

    expect(await insertXBloomBrews(db, [brew('3001')])).toEqual({ inserted: ['3001'], duplicate: [] })
  })

  test('an id repeated within one call is inserted once, then reported as duplicate', async () => {
    const { db, statements } = harness([])

    const result = await insertXBloomBrews(db, [brew('4001'), brew('4001'), brew('4001')])

    expect(result).toEqual({ inserted: ['4001'], duplicate: ['4001', '4001'] })
    expect(statements.filter((s) => s === 'INSERT')).toHaveLength(1)
  })

  test('results keep input order across inserted and duplicate ids', async () => {
    const { db } = harness(['5002'])

    const result = await insertXBloomBrews(db, [brew('5001'), brew('5002'), brew('5003'), brew('5002')])

    expect(result).toEqual({ inserted: ['5001', '5003'], duplicate: ['5002', '5002'] })
  })

  test('a unique violation on insert (concurrent writer) is reported as duplicate', async () => {
    const { db } = harness([], { '6002': { code: 'ER_DUP_ENTRY' } })

    expect(await insertXBloomBrews(db, [brew('6001'), brew('6002')])).toEqual({ inserted: ['6001'], duplicate: ['6002'] })
  })

  test('a non-unique insert error is rethrown', async () => {
    const failure = { code: 'ER_LOCK_WAIT_TIMEOUT', message: 'lock wait timeout' }
    const { db } = harness([], { '7001': failure })

    await expect(insertXBloomBrews(db, [brew('7001')])).rejects.toBe(failure)
  })
})
