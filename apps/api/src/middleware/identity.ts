import type { Context, Next } from 'hono'
import { findAppUser, getDb, resolveAppUser } from '@brewdial/db'
import { trackWrite, writesFrozen } from './write-freeze.js'

const VALID = new Set(['toss_anon', 'web_local'])

export async function identityMiddleware(c: Context, next: Next) {
  const raw = c.req.header('X-BrewDial-Identity')
  if (raw) {
    const i = raw.indexOf(':')
    const provider = i >= 0 ? raw.slice(0, i) : ''
    const externalKey = i >= 0 ? raw.slice(i + 1) : ''
    if (VALID.has(provider) && externalKey.length >= 16) {
      // ROB-642 C3: valid header + resolve throws (DB down) → fail CLOSED (503) so a
      // private write can't silently become public. Garbage headers stay anonymous.
      try {
        // resolveAppUser creates a first-touch user even on a GET, so a freeze only looks up.
        const appUserId = writesFrozen()
          ? await findAppUser(getDb(), provider, externalKey)
          : await trackWrite(() => resolveAppUser(getDb(), provider, externalKey))
        if (appUserId) c.set('appUserId', appUserId)
      } catch {
        return c.json({ ok: false, error: 'identity temporarily unavailable' }, 503)
      }
    }
  }
  await next()
}

export async function requireIdentity(c: Context, next: Next) {
  if (!c.get('appUserId')) return c.json({ ok: false, error: 'identity required' }, 401)
  await next()
}
