import * as Sentry from '@sentry/node'

// Pure so it can be tested without initialising the SDK. Returns null when there
// is no DSN: the caller must then not call Sentry.init at all.
export function sentryInitOptions(
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void = console.warn,
): Sentry.NodeOptions | null {
  const dsn = env.SENTRY_DSN
  if (!dsn) return null
  return {
    dsn,
    environment: env.NODE_ENV ?? 'development',
    release: env.GIT_SHA,
    tracesSampleRate: resolveTracesSampleRate(env.SENTRY_TRACES_SAMPLE_RATE, env.NODE_ENV, warn),
    // Single-operator traffic: keep request bodies, cookies and the Authorization header out of events.
    sendDefaultPii: false,
    // mysql2 query spans under each request. Route-pattern naming is in app.ts (Hono integration not used).
    integrations: [Sentry.mysql2Integration()],
  }
}

// 1.0 in production, 0 under NODE_ENV=test; SENTRY_TRACES_SAMPLE_RATE overrides both.
export function resolveTracesSampleRate(
  raw: string | undefined,
  nodeEnv: string | undefined,
  warn: (message: string) => void,
): number {
  const fallback = nodeEnv === 'test' ? 0 : 1
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (Number.isFinite(value) && value >= 0 && value <= 1) return value
  warn(`SENTRY_TRACES_SAMPLE_RATE=${JSON.stringify(raw)} is not a number in 0..1; using ${fallback}`)
  return fallback
}
