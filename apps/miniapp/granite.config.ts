import { defineConfig } from '@apps-in-toss/web-framework/config';

// appName must match the console registration (immutable).
export default defineConfig({
  appName: 'brewdial',
  brand: {
    displayName: 'BrewDial',
    primaryColor: '#6F4E37', // coffee brown
    icon: '', // 콘솔에서 업로드한 로고 URL
  },
  web: {
    host: 'localhost',
    port: 5173,
    commands: {
      dev: 'vite dev',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
  webViewProps: {
    type: 'partner', // 비게임 — 플랫폼 제공 상단 내비게이션 바
  },
});
