# BrewDial

Agent-friendly coffee recipe and feedback dial-in system.

BrewDial records brewing recipes, captures tasting feedback, and helps humans
and agents iteratively dial in a brew. The system is agent-agnostic — it does
not assume any specific agent or client.

## Status

**CouchDB foundation (PR2).** Monorepo skeleton plus a server-only CouchDB
client, `/api/health` and `/api/db/health` endpoints, and bootstrap/health
scripts. MCP server, auth, and deployment are intentionally deferred to
later PRs.

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

`pnpm test` runs Vitest in both workspaces (covers shared feedback rules and
CouchDB helpers; no live CouchDB required). `pnpm lint` remains an intentional
no-op stub until ESLint is wired up in a later PR.

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

## Recipe / Feedback API

PR4 adds the JSON API for recipes and feedback. All endpoints require CouchDB to
be running and bootstrapped (`pnpm db:bootstrap`).

```bash
# Create a recipe
curl -X POST http://localhost:5173/api/recipes \
  -H 'content-type: application/json' \
  -d '{
    "method": "v60",
    "title": "Test V60",
    "params": { "doseG": 15, "waterG": 240, "tempC": 92 },
    "steps": [{ "atSec": 0, "waterG": 40, "note": "Bloom" }]
  }'

# List recipes (newest first, default limit 20, max 100)
curl http://localhost:5173/api/recipes
curl 'http://localhost:5173/api/recipes?limit=5'

# Get one recipe by code
curl http://localhost:5173/api/recipes/COF-0001

# Add feedback for a recipe
curl -X POST http://localhost:5173/api/feedback \
  -H 'content-type: application/json' \
  -d '{
    "recipeCode": "COF-0001",
    "ratings": { "overall": 4, "sweetness": 3, "burnt": 1 },
    "comment": "Sweetness was good; no burnt taste."
  }'

# List feedback for a recipe
curl 'http://localhost:5173/api/feedback?recipeCode=COF-0001'
```

Recipe codes are minted by a CouchDB counter document (`counter:recipe`) and
formatted as `COF-NNNN` (zero-padded to 4 digits). Feedback document IDs are of
the form `feedback:<recipeCode>:<timestamp-suffix>`. CouchDB credentials are
never echoed in API responses or logs.

## Mobile UI MVP

PR5 adds a mobile-first SvelteKit web UI for humans on top of the PR4 API.
Pages call the existing repository helpers server-side via SvelteKit `load`
functions and form `actions` — no client-side `fetch` to the local API. The
JSON API endpoints from PR4 remain unchanged for agents and the future MCP
server.

Routes:

- `/` — dashboard with most recent 5 recipes
- `/recipes` — recipe list (`?limit=N`, default 20, max 100)
- `/recipes/new` — manual recipe creation form
- `/recipes/COF-0001` — recipe detail with feedback history
- `/feedback/new?recipeCode=COF-0001` — feedback creation form

The UI requires a running, bootstrapped CouchDB (`pnpm db:bootstrap`) for real
data; without it, pages render a safe error message instead of stack traces or
config.

```bash
pnpm dev
# open http://localhost:5173
```

## License

TBD.
