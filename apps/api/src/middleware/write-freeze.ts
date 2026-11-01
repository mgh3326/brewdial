import { existsSync } from 'node:fs'
import type { Context, Next } from 'hono'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// The phase-4 window (docs/runbooks/oci-heatwave-cutover.md) creates this file to
// stop writes without a restart. Read per request so that it takes effect at once.
export function writesFrozen(): boolean {
  const file = process.env.BREWDIAL_WRITE_FREEZE_FILE
  return Boolean(file) && existsSync(file as string)
}

// Runs before routing, so an unknown path answers 503 while frozen and 404 otherwise.
// heatwave-phase4.sh uses that as a probe that can never write.
export async function writeFreeze(c: Context, next: Next) {
  if (!READ_METHODS.has(c.req.method) && writesFrozen()) {
    return c.json({ ok: false, error: 'read-only maintenance' }, 503, { 'Retry-After': '300' })
  }
  await next()
}
