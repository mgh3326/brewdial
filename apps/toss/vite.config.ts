import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Plain Svelte + Vite SPA. `granite build` runs `vite build` (see granite.config.ts)
// and packages the static `dist/` output into a `.ait` bundle for the console.
export default defineConfig({
  plugins: [svelte()],
  // Relative base so assets resolve correctly inside the Toss WebView host.
  base: './',
  // The monorepo keeps .env at the repo root, not in apps/toss — load it so
  // VITE_SUPABASE_* are injected at build time.
  envDir: '../../',
});
