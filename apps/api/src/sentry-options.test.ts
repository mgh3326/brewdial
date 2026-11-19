import { describe, expect, test, vi } from 'vitest'
import { resolveTracesSampleRate, sentryInitOptions } from './sentry-options.js'

const DSN = 'https://public@127.0.0.1:9/1'

describe('sentryInitOptions', () => {
  test('returns null without SENTRY_DSN, so Sentry.init is never called', () => {
    expect(sentryInitOptions({ NODE_ENV: 'production' })).toBeNull()
    expect(sentryInitOptions({ SENTRY_DSN: '', NODE_ENV: 'production' })).toBeNull()
  })

  test('with a DSN: no PII, traces on, environment and release from env', () => {
    const options = sentryInitOptions({ SENTRY_DSN: DSN, NODE_ENV: 'production', GIT_SHA: 'abc1234' })
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'production',
      release: 'abc1234',
      tracesSampleRate: 1,
      sendDefaultPii: false,
    })
    expect(options?.integrations).toHaveLength(1)
  })
})

describe('resolveTracesSampleRate', () => {
  const noWarn = () => {}

  test('defaults to 1 outside tests and 0 under NODE_ENV=test', () => {
    expect(resolveTracesSampleRate(undefined, 'production', noWarn)).toBe(1)
    expect(resolveTracesSampleRate('  ', undefined, noWarn)).toBe(1)
    expect(resolveTracesSampleRate(undefined, 'test', noWarn)).toBe(0)
  })

  test('an explicit value wins, including 0 and fractions', () => {
    expect(resolveTracesSampleRate('0.25', 'production', noWarn)).toBe(0.25)
    expect(resolveTracesSampleRate('0', 'production', noWarn)).toBe(0)
    expect(resolveTracesSampleRate('1', 'test', noWarn)).toBe(1)
  })

  test.each(['abc', '1.5', '-0.1', 'Infinity'])('invalid %j logs once and uses the default', (raw) => {
    const warn = vi.fn()
    expect(resolveTracesSampleRate(raw, 'production', warn)).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('SENTRY_TRACES_SAMPLE_RATE')
    expect(resolveTracesSampleRate(raw, 'test', warn)).toBe(0)
  })
})
