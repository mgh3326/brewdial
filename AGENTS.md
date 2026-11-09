# BrewDial

Agent-friendly coffee recipe and dial-in system. pnpm workspace, Node >= 22.

## Layout

- `apps/api` — Hono 기반 Node API. 프로덕션에서 MySQL을 사용
- `apps/mcp` — MCP server (stdio)
- `apps/miniapp` — 앱인토스 미니앱 (Vite SPA, `web:build` → `.ait`). `src/lib/domain/*`은 `packages/shared`에서 생성한 사본
- `packages/db` — schema, migrations (`db:migrate`), codegen
- `packages/shared` — 공용 타입/로직
- `wrangler.jsonc` — Cloudflare Worker (Static Assets): `apps/miniapp/dist`를 SPA로 서빙

## Commands

```bash
pnpm build      # 전체 빌드
pnpm check      # 타입 체크
pnpm test       # 테스트
pnpm lint
pnpm db:migrate # 마이그레이션 적용
pnpm domain:sync                           # shared → miniapp domain 사본 재생성
```

## Notes

- 웹 브라우징이 필요하면 claude-in-chrome MCP(`mcp__claude-in-chrome__*`)를 사용한다.
- 마이그레이션 추가 전에 프로덕션에 이미 적용된 버전을 `pgmigrations` 테이블에서 확인할 것.
- 도메인 규칙의 원본은 `packages/shared`다. `apps/miniapp/src/lib/domain`은 직접 고치지 말고 `pnpm domain:sync`로 다시 만든다(CI `pnpm domain:check`).
