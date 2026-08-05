import { defineConfig } from '@apps-in-toss/web-framework/config';

// appName must match the console registration (immutable).
export default defineConfig({
  appName: 'brewdial',
  brand: {
    displayName: 'BrewDial',
    primaryColor: '#6F4E37', // coffee brown
    icon: 'https://static.toss.im/appsintoss/53429/538b5f0c-1788-4d6f-8c47-e664d8d6d8bd.png', // 콘솔 앱 로고
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
