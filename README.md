# BrewDial

Agent-friendly coffee recipe and feedback dial-in system.

BrewDial records brewing recipes, captures tasting feedback, and helps humans
and agents iteratively dial in a brew. The system is agent-agnostic — it does
not assume any specific agent or client.

## Status

**Skeleton (PR1).** Repository layout, SvelteKit shell, shared types, and a
`/api/health` endpoint. CouchDB integration, MCP server, auth, and deployment
are intentionally deferred to later PRs.

## Planned architecture

```text
Mobile Web UI
  -> SvelteKit backend/API (apps/web)
    -> CouchDB

Hermes / OpenClaw / other agents
  -> BrewDial MCP server
    -> BrewDial web API
      -> CouchDB
```

Public service domain (planned): **`coffee.robinco.dev`**.

See [`docs/decisions/0001-initial-architecture.md`](docs/decisions/0001-initial-architecture.md) for full architectural rationale.

## Repository structure

```text
apps/
  web/               # @brewdial/web — SvelteKit app
packages/
  shared/            # @brewdial/shared — TypeScript types and helpers
docs/
  decisions/         # architecture decision records (ADRs)
  superpowers/       # design specs and implementation plans
```

## Local development

Requires Node ≥22 and pnpm 10.33.2 (pinned via `packageManager`).

```bash
pnpm install
pnpm dev      # starts apps/web on http://localhost:5173
pnpm check    # svelte-check + tsc --noEmit across workspaces
pnpm build    # builds apps/web
```

`pnpm test` and `pnpm lint` are intentional no-op stubs in PR1. ESLint and
Vitest will be wired up in a later PR.

## Health check

Once `pnpm dev` is running:

```bash
curl http://localhost:5173/api/health
# {"ok":true,"service":"brewdial-web","version":"0.1.0"}
```

## License

TBD.
