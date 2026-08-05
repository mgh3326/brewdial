import './instrument'; // must be first — initialises Sentry before any app code

import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import config from '../granite.config';
import App from './App';
import './index.css';
import { setApiBaseUrl } from './lib/api';

// ── .ait runtime API base ──────────────────────────────────────────────────────
// Resolution order (first non-empty value wins):
//   1. window.__BREWDIAL_API_BASE__  — injected by the Toss host at runtime,
//      e.g. via a thin <script> in index.html or a Toss-provided config file.
//      Changing the API host does NOT require a .ait resubmit; just update the
//      host-injected value.
//   2. import.meta.env.VITE_API_BASE_URL  — baked in at build time (default).
//
// To use option 1, add to index.html before the bundle:
//   <script>window.__BREWDIAL_API_BASE__ = 'https://api.brewdial.robinco.dev';</script>
// or have the Toss WebView host inject it via postMessage / native bridge.
{
  const runtimeBase =
    typeof window !== 'undefined'
      ? ((window as unknown as Record<string, unknown>).__BREWDIAL_API_BASE__ as string | undefined)
      : undefined;
  if (runtimeBase) setApiBaseUrl(runtimeBase);
  // When runtimeBase is absent, api.ts falls back to VITE_API_BASE_URL automatically.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={<p style={{ padding: 24 }}>문제가 발생했어요. 잠시 후 다시 시도해 주세요.</p>}
    >
      <TDSMobileAITProvider brandPrimaryColor={config.brand.primaryColor}>
        <App />
      </TDSMobileAITProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>
);
