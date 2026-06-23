import * as Sentry from '@sentry/react';

// Sentry must initialise before any app code runs, so this file is imported
// first in main.tsx. The DSN is a public value, injected from the repo-root
// .env at build time (Vite inlines VITE_* — see vite.config.ts envDir).
const dsn = import.meta.env.VITE_SENTRY_DSN;

Sentry.init({
  dsn,
  // SDK no-ops when the DSN is absent (e.g. a local build without .env), so a
  // missing key never breaks the app — it just stops sending events.
  enabled: Boolean(dsn),

  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,

  // The same bundle ships to the Toss WebView (.ait) and the browser web build.
  // __BREWDIAL_TARGET__ is defined per build in vite.config.ts so issues stay
  // separable by surface without standing up a second Sentry project.
  initialScope: { tags: { surface: __BREWDIAL_TARGET__ } },

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],

  // Full traces in dev; sample down in production.
  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.2,

  // Record replays only around errors — keeps overhead negligible for a
  // lightweight mini-app while still capturing the lead-up to a crash.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,
});
