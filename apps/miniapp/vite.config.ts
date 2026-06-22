import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Fail a production build (the .ait bundle) when Supabase env is missing,
  // so we never silently ship an app where every data call hits a placeholder
  // host. The runtime placeholder fallback in supabase.ts stays for dev only.
  const env = loadEnv(mode, '../../', 'VITE_');
  if (command === 'build' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error(
      '[brewdial] Production build requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (set them in the repo-root .env).'
    );
  }

  return {
    plugins: [react()],
    // Relative base so assets resolve inside the Toss WebView; load repo-root .env.
    base: './',
    envDir: '../../',
  };
});
