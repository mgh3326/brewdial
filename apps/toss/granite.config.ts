import { defineConfig } from '@apps-in-toss/web-framework/config';

// Apps in Toss WebView config (SDK 2.x). `appName` must match the console
// registration exactly and is immutable once registered.
export default defineConfig({
  appName: 'brewdial',
  brand: {
    displayName: 'BrewDial',
    primaryColor: '#6F4E37', // coffee brown
    icon: '', // 콘솔에 로고 업로드 후 이미지 URL을 붙여넣으세요.
  },
  web: {
    host: 'localhost',
    port: 5173,
    commands: {
      dev: 'vite --host',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
  webViewProps: {
    type: 'partner', // 비게임
  },
});
