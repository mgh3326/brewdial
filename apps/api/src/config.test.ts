import { expect, test } from 'vitest'
import { loadConfig } from './config.js'

test('throws when DATABASE_URL missing', () => {
  const prev = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  expect(() => loadConfig()).toThrow(/DATABASE_URL/)
  process.env.DATABASE_URL = prev
})
