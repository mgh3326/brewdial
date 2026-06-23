export const REDACT_KEYS = ['databaseUrl', 'password', 'token', 'external_key', 'authorization', 'agentToken']

export const log = {
  info: (msg: string, fields: Record<string, unknown> = {}) => emit('info', msg, fields),
  error: (msg: string, fields: Record<string, unknown> = {}) => emit('error', msg, fields),
}

function emit(level: string, msg: string, fields: Record<string, unknown>) {
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) safe[k] = REDACT_KEYS.includes(k) ? '[redacted]' : v
  console.log(JSON.stringify({ level, msg, ...safe, ts: new Date().toISOString() }))
}
