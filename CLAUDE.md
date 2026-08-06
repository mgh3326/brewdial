# BrewDial

Agent-friendly coffee recipe and dial-in system. pnpm workspace, Node >= 22.

## Layout

- `apps/api` — backend API
- `apps/mcp` — MCP server (stdio)
- `apps/miniapp` — 앱인토스 미니앱 (Vite SPA, `web:build` → `.ait`)
- `apps/web` — Cloudflare Worker
- `packages/db` — schema, migrations (`db:migrate`), codegen
- `packages/shared` — 공용 타입/로직

## Commands

```bash
pnpm build      # 전체 빌드
pnpm check      # 타입 체크
pnpm test       # 테스트
pnpm lint
pnpm db:migrate # 마이그레이션 적용
```

## Notes

- 웹 브라우징이 필요하면 claude-in-chrome MCP(`mcp__claude-in-chrome__*`)를 사용한다.
- 마이그레이션 추가 전에 프로덕션에 이미 적용된 버전을 `pgmigrations` 테이블에서 확인할 것.
