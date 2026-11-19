// No database: these tests check dispatch and pool options only.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const createPool = vi.hoisted(() => vi.fn())
vi.mock('mysql2', () => ({ createPool }))

import { closeDb, dbVendor, getDb, mysqlPoolOptions } from './db.js'
import { vendorFromUrl } from './vendor.js'

const savedUrl = process.env.DATABASE_URL

beforeEach(() => {
  createPool.mockReset()
  createPool.mockImplementation(() => ({
    on: vi.fn(),
    end: vi.fn((cb?: (err?: Error) => void) => cb?.()),
  }))
})

afterEach(async () => {
  await closeDb()
  if (savedUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = savedUrl
})

test('postgres:// and postgresql:// are refused with a message that names PostgreSQL and hides the password', () => {
  for (const url of ['postgres://u:secret@localhost:5432/db', 'postgresql://u:secret@localhost:5432/db']) {
    expect(() => vendorFromUrl(url)).toThrow(/PostgreSQL, which is no longer supported; use a mysql:\/\/ URL/)
    let message = ''
    try {
      vendorFromUrl(url)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).not.toContain('secret')
  }
})

test('mysql:// selects the MySQL vendor', () => {
  expect(vendorFromUrl('mysql://u:p@127.0.0.1:3306/db')).toBe('mysql')
})

test('any other scheme throws, names the accepted scheme, and does not echo the URL', () => {
  const url = 'sqlite://user:secret@host/db'
  expect(() => vendorFromUrl(url)).toThrow(/use mysql:\/\//)
  expect(() => vendorFromUrl(url)).toThrow(/"sqlite"/)
  let message = ''
  try {
    vendorFromUrl(url)
  } catch (err) {
    message = (err as Error).message
  }
  expect(message).not.toContain('secret')
  expect(() => vendorFromUrl('no-scheme-here')).toThrow(/"\(none\)"/)
})

test('getDb() with a mysql:// URL builds a mysql2 pool with a UTC session', async () => {
  const url = 'mysql://root:pw@127.0.0.1:3306/brewdial_test'
  process.env.DATABASE_URL = url
  expect(dbVendor()).toBe('mysql')

  getDb()
  expect(createPool).toHaveBeenCalledTimes(1)
  expect(createPool).toHaveBeenCalledWith(
    expect.objectContaining({ uri: url, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true }),
  )

  // Every new physical connection gets the session time zone pinned to UTC.
  const pool = createPool.mock.results[0].value as { on: ReturnType<typeof vi.fn> }
  const onConnection = pool.on.mock.calls.find(([event]) => event === 'connection')?.[1] as
    | ((conn: { query: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }) => void)
    | undefined
  expect(onConnection).toBeTypeOf('function')
  const conn = { query: vi.fn(), destroy: vi.fn() }
  onConnection!(conn)
  expect(conn.query).toHaveBeenCalledWith("set time_zone = '+00:00'", expect.any(Function))

  const failedSet = conn.query.mock.calls[0][1] as (err: Error | null) => void
  failedSet(new Error('boom'))
  expect(conn.destroy).toHaveBeenCalledTimes(1)
})

test('getDb() with a postgres:// URL throws before any driver is created', () => {
  process.env.DATABASE_URL = 'postgres://postgres:pw@localhost:5432/brewdial_test'
  expect(() => getDb()).toThrow(/PostgreSQL, which is no longer supported/)
  expect(createPool).not.toHaveBeenCalled()
})

test('getDb() rejects an unsupported scheme before any driver is created', () => {
  process.env.DATABASE_URL = 'redis://localhost:6379/0'
  expect(() => getDb()).toThrow(/use mysql:\/\//)
  expect(createPool).not.toHaveBeenCalled()
})

test('mysql2 typeCast turns tinyint(1) into booleans and leaves other columns alone', () => {
  const { typeCast } = mysqlPoolOptions('mysql://x') as {
    typeCast: (field: { type: string; length: number; string(): string | null }, next: () => unknown) => unknown
  }
  const next = () => 'passed-through'
  expect(typeCast({ type: 'TINY', length: 1, string: () => '1' }, next)).toBe(true)
  expect(typeCast({ type: 'TINY', length: 1, string: () => '0' }, next)).toBe(false)
  expect(typeCast({ type: 'TINY', length: 1, string: () => null }, next)).toBe(null)
  expect(typeCast({ type: 'LONG', length: 11, string: () => '5' }, next)).toBe('passed-through')
})
