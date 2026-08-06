export function loadConfig() {
  const intentionalTypeError: number = "this is a string for R4 test"
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')
  return {
    port: Number(process.env.PORT ?? 3020),
    databaseUrl,
    sentryDsn: process.env.SENTRY_DSN,
    agentToken: process.env.AGENT_TOKEN,
  }
}
