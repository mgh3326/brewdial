import { expect, test } from 'vitest'
import { loadConfig } from './config.js'

test('throws when DATABASE_URL missing', () => {
  const prev = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  expect(() => loadConfig()).toThrow(/DATABASE_URL/)
  process.env.DATABASE_URL = prev
})

test('refuses a postgres:// DATABASE_URL at startup, before the server binds', () => {
  const prev = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgres://u:secret@127.0.0.1:5432/brewdial'
  try {
    expect(() => loadConfig()).toThrow(/PostgreSQL, which is no longer supported; use a mysql:\/\/ URL/)
    let message = ''
    try {
      loadConfig()
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).not.toContain('secret')
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prev
  }
})
