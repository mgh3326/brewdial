import { existsSync } from 'node:fs'
import type { Context, Next } from 'hono'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Writes admitted before the freeze keep running after it starts. A check and its
// increment run in one tick, so this count is exact: once the file exists and the
// count reads 0, nothing in this process can still write.
let writesInFlight = 0

// The phase-4 window (docs/runbooks/oci-heatwave-cutover.md) creates this file to
// stop writes without a restart. Read per request so that it takes effect at once.
export function writesFrozen(): boolean {
  const file = process.env.BREWDIAL_WRITE_FREEZE_FILE
  return file !== undefined && file !== '' && existsSync(file)
}

// Counts `work` as a write until it settles, also when the client has gone away.
export async function trackWrite<T>(work: () => Promise<T>): Promise<T> {
  writesInFlight += 1
  try {
    return await work()
  } finally {
    writesInFlight -= 1
  }
}

// Runs before routing, so an unknown path answers 503 while frozen and 404 otherwise.
// heatwave-phase4.sh uses that as a probe that can never write, and reads the header
// to wait for admitted writes before it copies.
export async function writeFreeze(c: Context, next: Next) {
  if (READ_METHODS.has(c.req.method)) {
    await next()
    return
  }
  if (writesFrozen()) {
    return c.json({ ok: false, error: 'read-only maintenance' }, 503, {
      'Retry-After': '300',
      'X-Writes-In-Flight': String(writesInFlight),
    })
  }
  await trackWrite(next)
}
