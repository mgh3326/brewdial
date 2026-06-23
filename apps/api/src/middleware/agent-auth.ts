import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'

function constantTimeEqual(a: string, b: string): boolean {
  // Always compare fixed-length hashes to avoid length-based timing leaks
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export async function agentAuth(c: Context, next: Next) {
  const agentToken = process.env.AGENT_TOKEN
  if (!agentToken) {
    // Fail closed: if AGENT_TOKEN is unconfigured, reject every request
    throw new Error('AGENT_TOKEN is not set')
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ ok: false, error: 'agent auth required' }, 401)
  }

  const provided = authHeader.slice('Bearer '.length)
  if (!constantTimeEqual(provided, agentToken)) {
    return c.json({ ok: false, error: 'agent auth required' }, 401)
  }

  await next()
}
