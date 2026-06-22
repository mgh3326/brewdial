import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Fail a production build when Supabase env is missing, so we never ship an app
  // where every data call hits a placeholder host. Accept env from a repo-root
  // .env file (local) OR process env (web hosts inject build vars there; Vite
  // inlines VITE_* from process env natively, so only the guard needs the fallback).
  const fileEnv = loadEnv(mode, '../../', 'VITE_');
  const url = fileEnv.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (command === 'build' && (!url || !key)) {
    throw new Error(
      '[brewdial] Production build requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (repo-root .env locally, or host env vars when deploying to the web).'
    );
  }

  // Browser target: @toss/tds-mobile* throws outside App-in-Toss, so swap it for
  // a plain shim. The .ait (Toss) build leaves VITE_TARGET unset → real TDS.
  const isWeb = process.env.VITE_TARGET === 'web';
  const shim = fileURLToPath(new URL('./src/lib/tds-web-shim.tsx', import.meta.url));

  return {
    plugins: [react()],
    // Relative base so assets resolve inside the Toss WebView; load repo-root .env.
    base: './',
    envDir: '../../',
    // Surface the build target to runtime code (Sentry tags Toss vs. web errors).
    define: {
      __BREWDIAL_TARGET__: JSON.stringify(isWeb ? 'web' : 'toss'),
    },
    ...(isWeb
      ? {
          resolve: {
            alias: {
              '@toss/tds-mobile-ait': shim,
              '@toss/tds-mobile': shim,
            },
          },
        }
      : {}),
  };
});
