# @brewdial/toss — Apps in Toss WebView mini-app (Phase 0 spike)

A minimal Svelte + Vite SPA wired for Apps in Toss (SDK 2.x). Its only job right
now is to **de-risk the two unknowns** before the full port:

1. **Web Audio** — does the BrewDial pour-timer tone (gesture unlock + clock
   scheduling) fire inside the Toss WebView, including after the screen locks?
2. **SDK bridge / build** — does a non-React Svelte+Vite app build into a `.ait`
   and resolve bridge calls (`getOperationalEnvironment`, `setScreenAwakeMode`)?

The audio core (`src/lib/tone.ts`) has **no SDK dependency**, so it always runs
even in a plain browser. Bridge calls (`src/lib/toss.ts`) are guarded.

## Prerequisites
- Node ≥ 22, pnpm (repo uses `pnpm@10.x`)
- The `appName` is **`brewdial`** and must match the console registration.

## Run locally (plain browser sanity check)
```bash
pnpm install
pnpm --filter @brewdial/toss vite:dev   # http://localhost:5173 — audio works, env shows "web"
```

## Run in the sandbox app (real bridge)
```bash
pnpm --filter @brewdial/toss dev        # granite dev (serves for the sandbox app)
```
Then open `intoss://brewdial` in the Apps-in-Toss sandbox app. On a physical
iPhone, connect over the same Wi-Fi and set `web.host` to your LAN IP (see
`granite.config.ts`). On Android emulator/device: `adb reverse tcp:5173 tcp:5173`.

## Build the `.ait` and test in the real Toss app
```bash
pnpm --filter @brewdial/toss build      # ait build -> brewdial.ait
```
Upload `brewdial.ait` in the console (앱 출시), then scan the QR to launch via
`intoss-private://brewdial?_deploymentId=…` on a real iPhone.

## What to verify on a real iPhone (the actual spike goal)
- [ ] "톤 테스트" plays a beep after the first tap (audio unlock works in WebView).
- [ ] "3초 뒤 톤" still fires after you **lock the screen** then turn it back on.
- [ ] `실행 환경` shows `toss`/`sandbox` (bridge resolved), not `web`.
- [ ] `화면 항상 켜짐` shows ✅ (`setScreenAwakeMode` accepted).
- [ ] No white screen on launch; safe-area padding looks right on a notched device.

If all pass, proceed to Phase 1 (port the timer + recipe/feedback UI onto this
shell with the Supabase data layer).
