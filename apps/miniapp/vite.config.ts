import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Fail a production build (the .ait bundle) when Supabase env is missing,
  // so we never silently ship an app where every data call hits a placeholder
  // host. The runtime placeholder fallback in supabase.ts stays for dev only.
  // Accept env from a repo-root .env file (local) OR process env (web hosts like
  // Cloudflare Pages / Vercel inject build vars there; Vite inlines VITE_* from
  // process env natively, so only the guard needs the fallback).
  const fileEnv = loadEnv(mode, '../../', 'VITE_');
  const url = fileEnv.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (command === 'build' && (!url || !key)) {
    throw new Error(
      '[brewdial] Production build requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (repo-root .env locally, or host env vars when deploying to the web).'
    );
  }

  return {
    plugins: [react()],
    // Relative base so assets resolve inside the Toss WebView; load repo-root .env.
    base: './',
    envDir: '../../',
  };
});
