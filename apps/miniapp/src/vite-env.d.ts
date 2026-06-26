/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected per build by vite.config.ts: 'toss' for the .ait WebView build,
// 'web' for the browser build.
declare const __BREWDIAL_TARGET__: string;
