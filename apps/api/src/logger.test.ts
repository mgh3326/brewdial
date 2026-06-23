import { expect, test, vi } from 'vitest'
import { log, REDACT_KEYS } from './logger.js'

test('redacts secret-bearing fields', () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  log.info('probe', { token: 'sekret', external_key: 'abc', safe: 'ok' })
  const out = spy.mock.calls[0][0] as string
  expect(out).not.toContain('sekret')
  expect(out).not.toContain('abc')
  expect(out).toContain('ok')
  spy.mockRestore()
})

test('REDACT_KEYS covers all required keys', () => {
  expect(REDACT_KEYS).toContain('databaseUrl')
  expect(REDACT_KEYS).toContain('password')
  expect(REDACT_KEYS).toContain('token')
  expect(REDACT_KEYS).toContain('external_key')
  expect(REDACT_KEYS).toContain('authorization')
  expect(REDACT_KEYS).toContain('agentToken')
})
