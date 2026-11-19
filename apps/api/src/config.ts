import { dbVendor } from '@brewdial/db'

export function loadConfig() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')
  dbVendor() // refuses postgres:// and other non-mysql schemes before the server binds
  return {
    port: Number(process.env.PORT ?? 3020),
    databaseUrl,
    sentryDsn: process.env.SENTRY_DSN,
    agentToken: process.env.AGENT_TOKEN,
  }
}
