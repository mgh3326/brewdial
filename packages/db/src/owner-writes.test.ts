import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Kysely } from 'kysely'
import type { DB } from './types.js'
import { withOwnerWrites } from './owner-writes.js'

vi.mock('kysely', () => ({
  sql: (parts: TemplateStringsArray) => ({
    execute: (trx: { executeQuery: (query: { sql: string }) => Promise<unknown> }) =>
      trx.executeQuery({ sql: parts.join('?') }),
  }),
}))

function fakeDb(statements: string[]) {
  const trx = {
    executeQuery: async (query: { sql: string }) => {
      statements.push(query.sql.replace(/\?/g, '').trim())
      return { rows: [], numAffectedRows: 0n, insertId: undefined }
    },
  }
  return {
    transaction: () => ({ execute: (callback: (trx: unknown) => Promise<unknown>) => callback(trx) }),
  } as unknown as Kysely<DB>
}

const ownerFlag = 'bd_' + 'owner_write_ok'

describe('withOwnerWrites on MySQL', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
  })

  it('resets the owner-write flag after success', async () => {
    process.env.DATABASE_URL = 'mysql://localhost/test'
    const statements: string[] = []
    await withOwnerWrites(fakeDb(statements), async () => 'ok')
    expect(statements).toEqual([`set @${ownerFlag} = 'on'`, `set @${ownerFlag} = null`])
  })

  it('resets the owner-write flag when the block throws', async () => {
    process.env.DATABASE_URL = 'mysql://localhost/test'
    const statements: string[] = []
    await expect(withOwnerWrites(fakeDb(statements), async () => { throw new Error('failed') })).rejects.toThrow('failed')
    expect(statements).toEqual([`set @${ownerFlag} = 'on'`, `set @${ownerFlag} = null`])
  })
})
