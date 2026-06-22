import * as Sentry from '@sentry/node';

// Initialised before any other module via the first import in index.ts.
// SENTRY_DSN reaches this process through the launch wrapper, which sources
// the repo-root .env (see services/brewdial-operator/.mcp.json). The DSN is a
// public value; the service-role Supabase secret is what must stay protected.
const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  // No-op when the DSN is absent (tests, local runs) — never blocks startup.
  enabled: Boolean(dsn),

  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',

  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.2,

  // NB: `includeLocalVariables` is intentionally left off — it opens a Node
  // inspector port on startup, which is unwanted for a per-session stdio server.

  enableLogs: true,

  // This is a stdio MCP server: the protocol owns stdout, so never enable
  // `debug` here — Sentry transmits over the network and writes nothing to it.
});
