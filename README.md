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

## CouchDB foundation

PR2 wires the SvelteKit server to CouchDB via plain `fetch` (no SDK). The web
app, the bootstrap script, and the health probe all read configuration from
these environment variables:

```bash
COUCHDB_URL=http://127.0.0.1:5984
COUCHDB_DATABASE=coffee
COUCHDB_USERNAME=
COUCHDB_PASSWORD=
BREWDIAL_API_TOKEN=
```

`COUCHDB_URL` and `COUCHDB_DATABASE` have safe localhost defaults; the other
three are intentionally blank in `.env.example`. Copy that file to `.env` and
fill in real values for local CouchDB experiments — never commit the result.

If CouchDB is already installed locally (e.g. via Homebrew), start it:

```bash
brew services start couchdb
```

Then, from the repo root:

```bash
pnpm db:health      # prints safe status; exits non-zero if unreachable
pnpm db:bootstrap   # creates the database if missing, seeds preference:global
pnpm db:health      # confirms the database is reachable and lists docCount
```

The runtime equivalent is `GET /api/db/health` — it returns either a 200 JSON
status or a safe 503 response if CouchDB is unreachable. Credentials never
appear in script output, log lines, or HTTP responses.

`pnpm test` covers the helpers via mocked `fetch` — no live CouchDB required.

## License

TBD.
